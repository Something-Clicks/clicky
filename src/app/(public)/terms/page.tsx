import type { Metadata } from "next";

import { DraftBanner } from "@/components/draft-banner";

export const metadata: Metadata = { title: "Terms of Service (draft)", robots: { index: false, follow: false } };

/** DRAFT for attorney review. Describes the service as built today (Nov 2026). */
export default function TermsPage() {
  return (
    <article className="narrow legal">
      <DraftBanner />
      <h1 className="h1">Terms of Service</h1>
      <p className="muted">Draft dated November 24, 2026 · Something Clicks LLC, a Utah limited liability company</p>

      <h2>1. The service</h2>
      <p>
        Something Clicks checks the public pages of a website you choose and explains what may be worth improving. You
        decide what to change. We never change anything on your website or publish or send anything on your behalf.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need an account to save results and use more than one free check. Keep your sign-in details secure; you are
        responsible for activity in your account. The account owner controls billing.
      </p>

      <h2>3. Websites you check</h2>
      <p>
        Only check websites you own or are authorized to manage. Do not use the service to overload, test, or gather
        information from websites you have no right to review. We may limit or block checks to prevent abuse.
      </p>

      <h2>4. Free uses</h2>
      <p>
        You get three free uses: one check without an account and two more after you save it. A use is one completed
        check. We may change free uses in the future; changes do not affect uses already completed.
      </p>

      <h2>5. Plans and payment</h2>
      <ul>
        <li><b>Marketing Report</b> is a one-time purchase of $49.</li>
        <li>
          <b>Subscriptions</b> are billed monthly or yearly in advance and renew automatically until canceled. You can cancel
          any time in Manage billing; you keep access until the end of the paid period.
        </li>
        <li>Payments are processed by Stripe. Prices are in US dollars and may exclude taxes. [Attorney: refund policy.]</li>
        <li>If a payment fails, paid features may stop until it is resolved.</li>
        <li>We will give notice before changing the price of an existing subscription. [Attorney: notice period.]</li>
      </ul>

      <h2>6. Recommendations</h2>
      <p>
        Recommendations come from fixed checks of the public pages we read. They are suggestions, not professional advice,
        and can be incomplete or wrong. You are responsible for any change you make to your website.
      </p>

      <h2>7. No guarantees</h2>
      <p>
        We explain why each step tends to help, but we do not guarantee rankings, traffic, calls, sales, or any other
        result. The service is provided &quot;as is&quot;. [Attorney: warranty disclaimer wording.]
      </p>

      <h2>8. Your content</h2>
      <p>
        You keep ownership of your business information, and the items you mark done. You give us permission to
        process that content only to provide the service, as described in the Privacy Policy.
      </p>

      <h2>9. Acceptable use</h2>
      <p>
        Do not misuse the service: no illegal content, no attempts to break security or other customers&apos; separation, no
        automated sign-ups or scraping, and no reselling without permission.
      </p>

      <h2>10. Ending the service</h2>
      <p>
        You can stop using the service and cancel any time. We may suspend or close accounts that break these terms. Ask us
        to delete your account by email. [Attorney: data after termination.]
      </p>

      <h2>11. Limitation of liability</h2>
      <p>[Attorney: limitation of liability and indemnity wording.]</p>

      <h2>12. Changes and law</h2>
      <p>
        We may update these terms and will notify account owners of important changes. These terms are governed by the laws
        of the State of Utah. [Attorney: confirm governing law and venue.]
      </p>

      <h2>13. Contact</h2>
      <p>Something Clicks LLC · Salt Lake City, Utah · [contact email]</p>
    </article>
  );
}
