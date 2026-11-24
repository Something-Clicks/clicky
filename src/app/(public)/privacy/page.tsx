import type { Metadata } from "next";

import { DraftBanner } from "@/components/draft-banner";

export const metadata: Metadata = { title: "Privacy Policy (draft)", robots: { index: false, follow: false } };

/**
 * DRAFT. Written from what the code does today (Nov 2026). An attorney must review and
 * approve it before it is published as final. Update it whenever data handling changes.
 */
export default function PrivacyPage() {
  return (
    <article className="narrow legal">
      <DraftBanner />
      <h1 className="h1">Privacy Policy</h1>
      <p className="muted">Draft dated November 24, 2026 · Something Clicks LLC, a Utah limited liability company</p>

      <h2>What this covers</h2>
      <p>
        This policy explains what information Something Clicks (&quot;we&quot;) collects when you use somethingclicks.com,
        why, who helps us process it, and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <h3>When you check a website without an account</h3>
      <ul>
        <li>The website address and ZIP code you enter.</li>
        <li>
          A one-way, keyed hash of your network (IP) address, used only to limit how many checks one connection can run.
          We do not store the address itself.
        </li>
        <li>The results of the check (see &quot;Website content we process&quot;).</li>
        <li>A cookie holding a random code that lets your browser, and only your browser, view those results.</li>
      </ul>
      <h3>When you choose Save this</h3>
      <ul>
        <li>
          Your email address, linked to your results, and a one-way hash of a single-use code that is sent to you in a
          sign-in link. The link expires after 24 hours and works once. Your results move into your account only when
          you sign in with that same, verified email address.
        </li>
      </ul>
      <h3>When you have an account</h3>
      <ul>
        <li>Your name (if you give it), email address, and password. Passwords are handled by our authentication provider and stored only in hashed form.</li>
        <li>Your business name, website, ZIP code, and any service area or goal you add.</li>
        <li>The people you add to your account and their roles.</li>
        <li>Your website checks, findings, drafts you create, your notes, and your approval decisions.</li>
        <li>A history of important actions in your account (for example, a check started or a draft approved).</li>
        <li>Your notification preferences and a record of notification emails we tried to send.</li>
      </ul>
      <h3>Feedback</h3>
      <ul>
        <li>
          A thumbs up or down, any words you write, and the same hashed network address (to limit spam). If you tick
          &quot;Okay to email me one follow-up&quot;, we store your account email separately from the feedback, for that
          one message only.
        </li>
      </ul>
      <h3>Usage counts</h3>
      <ul>
        <li>
          We count steps such as &quot;check started&quot; or &quot;checkout started&quot; in our own database. These counts contain
          no names, email addresses, or website content.
        </li>
      </ul>
      <h3>Analytics (only if you say yes)</h3>
      <ul>
        <li>
          If you choose Yes in the cookie banner, we load Google Analytics 4 (pages visited, device and browser type,
          approximate location) and Microsoft Clarity (clicks, scrolling, and session recordings). Forms, your results,
          drafts, and everything inside your account are masked in recordings. We send page addresses without the part
          after &quot;?&quot;, so sign-in codes are never shared. If you choose No, neither is loaded. You can change your choice
          any time with &quot;Cookie settings&quot; at the bottom of each page.
        </li>
      </ul>
      <h3>Payments</h3>
      <ul>
        <li>
          Payments are handled by Stripe. We never see or store your full card number. We store your Stripe customer
          ID, your plan, its status and renewal date, and amounts paid.
        </li>
      </ul>

      <h2>Website content we process</h2>
      <p>
        To check a website, our servers read its public pages: the homepage and up to four other pages on the same site
        (such as contact, services, about, pricing, or locations). We record observations such as the page title, meta
        description, headings, whether a phone number is a tap-to-call link, image descriptions, and short excerpts of
        page text. We send the homepage address to Google PageSpeed Insights to measure mobile speed. We only read pages
        that are publicly available; please check only websites you own or are authorized to manage.
      </p>

      <h2>How drafts and wording are prepared</h2>
      <p>
        We use an AI service, Anthropic&apos;s Claude, to (1) rewrite the wording of findings in plain language and (2)
        prepare drafts such as page titles, homepage copy, Google Business Profile posts, and blog posts. For this we
        send Anthropic the findings, the evidence and short excerpts from your website, your business name, website,
        service area and goal, and any notes you add. The AI is not allowed to add findings or change the evidence, and
        drafts use placeholders instead of making up facts. You review every draft; we never publish anything for you.
        [Attorney: confirm Anthropic&apos;s commercial terms on data retention and training, and describe them here.]
      </p>

      <h2>Why we use information</h2>
      <ul>
        <li>To provide the service: check websites, show results, prepare drafts, and keep your account.</li>
        <li>To sign you in and verify your email address.</li>
        <li>To process payments and give you the plan you paid for.</li>
        <li>To send emails you asked for: sign-in links, password resets, and notifications you have turned on.</li>
        <li>To prevent abuse (rate limits, spam checks) and keep the service secure.</li>
        <li>To understand and improve the product (usage counts, feedback, and analytics if you agreed).</li>
      </ul>
      <p>We do not sell your personal information. We do not use it for advertising.</p>

      <h2>Service providers</h2>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">What they do</th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row">Supabase</th><td>Database and sign-in (accounts, results, drafts, sessions, sign-in emails).</td></tr>
          <tr><th scope="row">Vercel</th><td>Hosting. Receives every web request, including network addresses, in its logs.</td></tr>
          <tr><th scope="row">Anthropic</th><td>AI service that words findings and prepares drafts (see above).</td></tr>
          <tr><th scope="row">Google PageSpeed Insights</th><td>Measures the mobile speed of the website address you check.</td></tr>
          <tr><th scope="row">Stripe</th><td>Payments, subscriptions, invoices, and the billing portal.</td></tr>
          <tr><th scope="row">Resend</th><td>Sends our emails (sign-in links and notifications).</td></tr>
          <tr><th scope="row">Google Analytics 4</th><td>Product analytics, only after you say yes.</td></tr>
          <tr><th scope="row">Microsoft Clarity</th><td>Heatmaps and masked session recordings, only after you say yes.</td></tr>
        </tbody>
      </table>
      <p>These providers process information on our behalf. [Attorney: confirm data processing agreements and international transfer terms.]</p>

      <h2>How long we keep information</h2>
      <ul>
        <li>Results from a check without an account: deleted after seven days (sooner if you save them to an account).</li>
        <li>Save this links: expire after 24 hours and work once.</li>
        <li>Account information, checks, drafts, and history: kept while your account is open.</li>
        <li>Feedback and usage counts: [decide a retention period].</li>
        <li>Payment records: kept as long as required for tax and accounting. [Attorney: confirm period.]</li>
        <li>Hosting logs: kept according to Vercel&apos;s retention settings. [Confirm.]</li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Change your analytics choice at any time with &quot;Cookie settings&quot;.</li>
        <li>Turn notification emails on or off in Settings.</li>
        <li>
          Ask us to see, correct, export, or delete your information by emailing [privacy contact email]. Account
          deletion is handled by request today; we will confirm when it is done. [Attorney: add state-specific rights and
          response times.]
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Each business&apos;s information is kept separate from every other account by database rules. Secret codes (sign-in
        links, result codes, server keys) are stored only as one-way hashes. No method is perfectly secure, but we work to
        protect your information.
      </p>

      <h2>Children</h2>
      <p>Something Clicks is for businesses and is not directed to children under 13. [Attorney: confirm age.]</p>

      <h2>Changes</h2>
      <p>If we change this policy, we will update the date above and, for important changes, tell account owners by email.</p>

      <h2>Contact</h2>
      <p>Something Clicks LLC · Salt Lake City, Utah · [privacy contact email] · [mailing address]</p>
    </article>
  );
}
