import type { Metadata } from 'next'
import LegalShell from '../_components/LegalShell'

export const metadata: Metadata = {
  title: 'Cookie Policy — RSends',
  description:
    'How RSends uses cookies and similar technologies on the platform, dashboard, and marketing site.',
}

export default function CookiesPage() {
  return (
    <LegalShell
      eyebrow="Cookie Policy"
      title="Cookie Policy"
      lastUpdated="April 25, 2026"
      breadcrumbLabel="Cookies"
    >
      <p>
        This Cookie Policy explains how Rpagos S.R.L (&quot;<strong>RSends</strong>&quot;) uses
        cookies and similar technologies on the RSends website, dashboard, and related services.
        It supplements our <a href="/docs/privacy">Privacy Policy</a>.
      </p>

      <h2>1. What are cookies?</h2>
      <p>
        Cookies are small text files placed on your device when you visit a website. They allow
        the site to recognise your device, remember your preferences, and operate certain
        features. We also use related technologies such as local storage, session storage, and
        pixel tags; we refer to all of these collectively as &quot;cookies&quot; in this Policy.
      </p>

      <h2>2. Categories of cookies we use</h2>

      <h3>Strictly necessary</h3>
      <p>
        These cookies are required for the Service to function and cannot be switched off. They
        support authentication, session integrity, fraud prevention, and load balancing.
      </p>
      <ul>
        <li>
          <code>__Host-session</code> — secure HTTP-only session cookie used to keep you signed in.
        </li>
        <li>
          <code>csrf</code> — anti-CSRF token used to protect form submissions and state-changing
          API requests.
        </li>
      </ul>

      <h3>Functional</h3>
      <p>
        These cookies remember the choices you make to improve your experience. They are not used
        for tracking across other sites.
      </p>
      <ul>
        <li>
          <code>NEXT_LOCALE</code> — remembers your preferred language.
        </li>
        <li>
          <code>theme</code> — remembers your light/dark theme preference (where applicable).
        </li>
      </ul>

      <h3>Analytics</h3>
      <p>
        We may use anonymised, aggregated analytics to understand how the Service is used and to
        improve it. Where we use such tools, we will update this Policy to list the specific
        provider, the data collected, and the retention period. We do not use analytics that
        build cross-site profiles of you.
      </p>

      <h3>Advertising and tracking</h3>
      <p>
        We do <strong>not</strong> use advertising cookies, retargeting pixels, or third-party
        tracking technologies on the Service.
      </p>

      <h2>3. Managing cookies</h2>
      <p>
        You can control cookies through your browser settings. Most browsers allow you to view
        existing cookies, block cookies from specific domains, or delete cookies entirely. Note
        that disabling strictly-necessary cookies may prevent the Service from functioning
        correctly.
      </p>
      <p>
        Browser-specific guidance:
      </p>
      <ul>
        <li>
          <a
            href="https://support.google.com/chrome/answer/95647"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Chrome
          </a>
        </li>
        <li>
          <a
            href="https://support.mozilla.org/en-US/kb/enhanced-tracking-protection-firefox-desktop"
            target="_blank"
            rel="noopener noreferrer"
          >
            Mozilla Firefox
          </a>
        </li>
        <li>
          <a
            href="https://support.apple.com/en-us/guide/safari/sfri11471/mac"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apple Safari
          </a>
        </li>
        <li>
          <a
            href="https://support.microsoft.com/en-us/microsoft-edge"
            target="_blank"
            rel="noopener noreferrer"
          >
            Microsoft Edge
          </a>
        </li>
      </ul>

      <h2>4. Changes to this Policy</h2>
      <p>
        We may update this Cookie Policy as our cookie usage evolves. The &quot;Last
        updated&quot; date at the top of this page reflects the most recent revision.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about this Cookie Policy:{' '}
        <a href="mailto:privacy@rsends.io">privacy@rsends.io</a>.
      </p>
    </LegalShell>
  )
}
