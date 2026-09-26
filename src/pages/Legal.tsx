import { Link } from 'react-router-dom'

export function TermsPage() {
  return (
    <article className="legal-page">
      <div className="container legal-content">
        <p className="section-kicker">&gt; legal</p>
        <h1 className="section-title">Terms of Service</h1>
        <p className="legal-updated">Last updated: September 23, 2026</p>

        <h2>1. Acceptance</h2>
        <p>
          By creating a noxware account you agree to these Terms of Service. If you do not agree,
          do not register or use the service.
        </p>

        <h2>2. Eligibility &amp; invites</h2>
        <p>
          Access is invite-only. You are responsible for keeping your account credentials secret
          and for activity under your account. Invitation codes are personal and may not be sold
          or redistributed without permission.
        </p>

        <h2>3. Accounts</h2>
        <p>
          You must provide accurate registration information. We may suspend or terminate accounts
          that abuse the service, share accounts, attempt unauthorized access, or violate these
          terms.
        </p>

        <h2>4. Payments</h2>
        <p>
          Paid plans are processed via cryptocurrency checkout. Fees, plan length, and activation
          timing depend on network confirmation. Chargebacks do not apply to crypto payments;
          contact support for billing issues.
        </p>

        <h2>5. Acceptable use</h2>
        <p>
          You may only use noxware for lawful purposes and in line with the rules of any platforms
          you interact with. You assume all risk associated with your use of the software.
        </p>

        <h2>6. Disclaimer</h2>
        <p>
          The service is provided “as is” without warranties of any kind. We do not guarantee
          uninterrupted availability, detection immunity, or fitness for a particular purpose.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, noxware is not liable for indirect, incidental,
          or consequential damages arising from use of the service.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these terms. Continued use after changes constitutes acceptance of the
          revised terms.
        </p>

        <p className="legal-back">
          <Link to="/?tab=register">← Back to register</Link>
        </p>
      </div>
    </article>
  )
}

export function PrivacyPage() {
  return (
    <article className="legal-page">
      <div className="container legal-content">
        <p className="section-kicker">&gt; legal</p>
        <h1 className="section-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: September 23, 2026</p>

        <h2>1. What we collect</h2>
        <p>
          Account data (email, username, password hash), invitation association, subscription and
          order records, license keys, and basic technical logs needed to operate the service.
        </p>

        <h2>2. Why we collect it</h2>
        <p>
          To authenticate you, process crypto payments, activate subscriptions, prevent abuse
          (including captcha checks), and provide support.
        </p>

        <h2>3. Processors</h2>
        <p>
          Payment confirmation may involve NOWPayments. Captcha may involve Cloudflare Turnstile
          when enabled. Those providers process data under their own policies.
        </p>

        <h2>4. Retention</h2>
        <p>
          We keep account and billing records while your account is active and as needed for
          security, dispute handling, and legal obligations.
        </p>

        <h2>5. Sharing</h2>
        <p>
          We do not sell personal data. We share data only with processors required to run
          checkout/security, or when required by law.
        </p>

        <h2>6. Your choices</h2>
        <p>
          You may request account deletion or a copy of your account data by contacting support
          from the email on your account.
        </p>

        <h2>7. Contact</h2>
        <p>Privacy questions: privacy@noxware.local (replace with your real contact).</p>

        <p className="legal-back">
          <Link to="/?tab=register">← Back to register</Link>
        </p>
      </div>
    </article>
  )
}
