import Image from "next/image";

import { TrackEvent } from "@/components/track-event";
import { StartForm } from "@/components/start-form";
import { HOME_HEADLINE, HOME_SUBHEAD } from "@/config/site";
import { formTicket, isPreviewEnabled, track } from "@/lib/server/site";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Homepage: one action. Below it, an example of the work (clearly labeled), not a feature list.
 */
export default async function HomePage() {
  await track("homepage_visit");
  const preview = isPreviewEnabled();
  return (
    <>
      <TrackEvent name="landing_visit" />
      <section className="home-hero" aria-labelledby="home-title">
        <Image className="art" src="/brand/clicky-3d.png" alt="Clicky, the Something Clicks character" width={720} height={502} priority />
        <h1 id="home-title">{HOME_HEADLINE}</h1>
        {HOME_SUBHEAD ? <p className="sub">{preview ? HOME_SUBHEAD : "Free to start. See your first results in about a minute."}</p> : null}
        <StartForm ticket={formTicket()} />
      </section>

      <section className="show" aria-labelledby="show-title">
        <p className="show-head" id="show-title">
          Here&apos;s the kind of thing you&apos;ll see
        </p>
        <div className="card action high">
          <div className="row">
            <span className="pill coral">High impact</span>
            <span className="pill">Example</span>
          </div>
          <h3>Make it easy to call you</h3>
          <p className="muted small">Your phone number isn&apos;t a tap-to-call link on your homepage.</p>
          <div className="evidence">
            <b>Observed</b> · your homepage
          </div>
        </div>
        <div className="card action">
          <div className="row">
            <span className="pill yellow">Medium impact</span>
            <span className="pill">Example</span>
          </div>
          <h3>Add a short description for search results</h3>
          <p className="muted small">Your homepage has no description, so search engines pick their own text.</p>
          <div className="evidence">
            <b>Missing</b> · your homepage
          </div>
        </div>
        <div className="card">
          <div className="row">
            <span className="pill green">Verified fixed</span>
            <span className="pill">Example</span>
          </div>
          <h3>Checked again next time</h3>
          <p className="muted small">We look again after you make a change and show what improved.</p>
        </div>
      </section>
    </>
  );
}
