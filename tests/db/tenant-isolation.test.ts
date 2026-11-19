import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb, type TestDb } from "./harness";

let db: TestDb;
let alice: string; // owner of Organization A
let bob: string; // owner of Organization B
let carol: string; // member (not owner) of Organization A
let admin: string; // platform admin
let orgA: string;
let orgB: string;

const PERMISSION_DENIED = /permission denied/;

async function createOrg(user: string, name: string, website = "https://example.com") {
  return db.as(user, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "select public.create_organization($1, $2, $3, $4) as id",
      [name, website, "Salt Lake City", "get_found"],
    );
    return rows[0]!.id;
  });
}

beforeAll(async () => {
  db = await setupTestDb();
  alice = await db.createUser("Alice A");
  bob = await db.createUser("Bob B");
  carol = await db.createUser("Carol C");
  admin = await db.createUser("Ada Admin");
  orgA = await createOrg(alice, "Alpha Plumbing");
  orgB = await createOrg(bob, "Bravo Bakery");
  await db.admin.query(
    "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')",
    [orgA, carol],
  );
  await db.admin.query("insert into public.platform_admins (user_id) values ($1)", [admin]);
}, 60_000);

afterAll(async () => {
  await db?.teardown();
});

describe("signup and organization creation", () => {
  it("creates a profile for every new auth user", async () => {
    const { rows } = await db.admin.query("select full_name from public.profiles where id = $1", [alice]);
    expect(rows[0]?.full_name).toBe("Alice A");
  });

  it("makes the creator the owner and saves the business profile and an activity entry", async () => {
    const result = await db.as(alice, async (c) => ({
      members: (await c.query("select user_id, role from public.organization_members where organization_id = $1", [orgA])).rows,
      profile: (await c.query("select business_name, website from public.business_profiles where organization_id = $1", [orgA])).rows,
      activity: (await c.query("select action from public.activity_log where organization_id = $1", [orgA])).rows,
    }));
    expect(result.members).toContainEqual({ user_id: alice, role: "owner" });
    expect(result.profile).toEqual([{ business_name: "Alpha Plumbing", website: "https://example.com" }]);
    expect(result.activity.map((r) => r.action)).toContain("organization.created");
  });

  it("rejects an invalid website", async () => {
    await expect(createOrg(alice, "Bad Site", "javascript:alert(1)")).rejects.toThrow(/check constraint/);
  });

  it("rejects anonymous organization creation", async () => {
    await expect(
      db.as(null, (c) => c.query("select public.create_organization('X', null, null, null)")),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it("limits a user to 5 owned organizations", async () => {
    const dave = await db.createUser("Dave");
    for (let i = 0; i < 5; i++) await createOrg(dave, `Dave ${i}`);
    await expect(createOrg(dave, "Dave 6")).rejects.toThrow(/Organization limit reached/);
  });
});

describe("Customer B cannot read Customer A's data", () => {
  const reads: Array<[string, string]> = [
    ["organizations", "select * from public.organizations where id = $1"],
    ["organization_members", "select * from public.organization_members where organization_id = $1"],
    ["business_profiles", "select * from public.business_profiles where organization_id = $1"],
    ["activity_log", "select * from public.activity_log where organization_id = $1"],
  ];

  for (const [table, sql] of reads) {
    it(`${table}: returns no rows for another tenant`, async () => {
      const own = await db.as(alice, (c) => c.query(sql, [orgA]));
      const other = await db.as(bob, (c) => c.query(sql, [orgA]));
      expect(own.rowCount).toBeGreaterThan(0);
      expect(other.rowCount).toBe(0);
    });
  }

  it("profiles: Bob cannot see Alice's profile", async () => {
    const { rowCount } = await db.as(bob, (c) => c.query("select * from public.profiles where id = $1", [alice]));
    expect(rowCount).toBe(0);
  });

  it("an unfiltered select only returns the caller's own tenant", async () => {
    const orgs = await db.as(bob, (c) => c.query<{ id: string }>("select id from public.organizations"));
    expect(orgs.rows.map((r) => r.id)).toEqual([orgB]);
  });

  it("anonymous visitors cannot read any table", async () => {
    for (const table of ["profiles", "organizations", "organization_members", "business_profiles", "activity_log", "platform_admins"]) {
      await expect(db.as(null, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(PERMISSION_DENIED);
    }
  });
});

describe("Customer B cannot modify Customer A's data", () => {
  it("cannot rename A's organization", async () => {
    const { rowCount } = await db.as(bob, (c) =>
      c.query("update public.organizations set name = 'Hacked' where id = $1", [orgA]),
    );
    expect(rowCount).toBe(0);
    const { rows } = await db.admin.query("select name from public.organizations where id = $1", [orgA]);
    expect(rows[0]?.name).toBe("Alpha Plumbing");
  });

  it("cannot change A's business profile", async () => {
    const { rowCount } = await db.as(bob, (c) =>
      c.query("update public.business_profiles set website = 'https://evil.example' where organization_id = $1", [orgA]),
    );
    expect(rowCount).toBe(0);
  });

  it("cannot change A's profile", async () => {
    const { rowCount } = await db.as(bob, (c) =>
      c.query("update public.profiles set full_name = 'Hacked' where id = $1", [alice]),
    );
    expect(rowCount).toBe(0);
  });

  it("cannot join A's organization by inserting a membership", async () => {
    await expect(
      db.as(bob, (c) =>
        c.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [orgA, bob]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it("cannot delete A's organization, members, profile or activity", async () => {
    for (const sql of [
      "delete from public.organizations where id = $1",
      "delete from public.organization_members where organization_id = $1",
      "delete from public.business_profiles where organization_id = $1",
      "delete from public.activity_log where organization_id = $1",
    ]) {
      await expect(db.as(bob, (c) => c.query(sql, [orgA]))).rejects.toThrow(PERMISSION_DENIED);
    }
  });

  it("cannot insert directly into organizations, business profiles or activity", async () => {
    await expect(
      db.as(bob, (c) => c.query("insert into public.organizations (name) values ('Direct')")),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      db.as(bob, (c) =>
        c.query("insert into public.business_profiles (organization_id, business_name) values ($1, 'x')", [orgA]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      db.as(bob, (c) =>
        c.query("insert into public.activity_log (organization_id, action) values ($1, 'fake.event')", [orgA]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it("cannot move a business profile to another organization", async () => {
    await expect(
      db.as(bob, (c) =>
        c.query("update public.business_profiles set organization_id = $1 where organization_id = $2", [orgA, orgB]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("roles inside one organization", () => {
  it("a member can read the organization and teammates' names", async () => {
    const result = await db.as(carol, async (c) => ({
      org: (await c.query("select name from public.organizations where id = $1", [orgA])).rows,
      teammate: (await c.query("select full_name from public.profiles where id = $1", [alice])).rows,
    }));
    expect(result.org).toEqual([{ name: "Alpha Plumbing" }]);
    expect(result.teammate).toEqual([{ full_name: "Alice A" }]);
  });

  it("a member cannot change the business profile; the owner can, and it is logged", async () => {
    const byMember = await db.as(carol, (c) =>
      c.query("update public.business_profiles set service_area = 'Ogden' where organization_id = $1", [orgA]),
    );
    expect(byMember.rowCount).toBe(0);

    const byOwner = await db.as(alice, (c) =>
      c.query("update public.business_profiles set service_area = 'Provo' where organization_id = $1", [orgA]),
    );
    expect(byOwner.rowCount).toBe(1);
    const { rows } = await db.admin.query(
      "select actor_id, metadata from public.activity_log where organization_id = $1 and action = 'business_profile.updated'",
      [orgA],
    );
    expect(rows).toEqual([{ actor_id: alice, metadata: { fields: ["service_area"] } }]);
  });

  it("activity entries cannot be edited, even by the owner", async () => {
    await expect(
      db.as(alice, (c) => c.query("update public.activity_log set action = 'x.y' where organization_id = $1", [orgA])),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe("platform admin", () => {
  it("non-admins are refused and cannot read the admin table", async () => {
    await expect(db.as(alice, (c) => c.query("select public.admin_overview()"))).rejects.toThrow(/Forbidden/);
    await expect(db.as(alice, (c) => c.query("select * from public.platform_admins"))).rejects.toThrow(PERMISSION_DENIED);
    const { rows } = await db.as(alice, (c) => c.query("select public.current_user_is_platform_admin() as ok"));
    expect(rows[0]?.ok).toBe(false);
  });

  it("admins get counts and names only, and each view is logged", async () => {
    const { rows } = await db.as(admin, (c) => c.query("select public.admin_overview() as o"));
    const overview = rows[0]!.o;
    expect(overview.organization_count).toBeGreaterThanOrEqual(2);
    expect(Object.keys(overview.organizations[0]).sort()).toEqual(["created_at", "id", "member_count", "name"]);
    const log = await db.admin.query(
      "select organization_id from public.activity_log where actor_id = $1 and action = 'admin.overview_viewed'",
      [admin],
    );
    expect(log.rows).toEqual([{ organization_id: null }]);
  });

  it("admin activity is not visible to customers", async () => {
    const { rowCount } = await db.as(alice, (c) =>
      c.query("select * from public.activity_log where action like 'admin.%'"),
    );
    expect(rowCount).toBe(0);
  });
});

describe("database guarantees", () => {
  it("every table in public has row level security enabled", async () => {
    const { rows } = await db.admin.query(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(rows).toEqual([]);
  });

  it("private helper and audit functions cannot be called by anonymous visitors", async () => {
    await expect(db.as(null, (c) => c.query("select app_private.is_platform_admin()"))).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      db.as(alice, (c) => c.query("select app_private.log_activity($1, 'fake.event', null, null, '{}')", [orgB])),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});
