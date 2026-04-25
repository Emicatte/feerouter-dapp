import type { Metadata } from 'next'
import LegalShell from '../_components/LegalShell'

export const metadata: Metadata = {
  title: 'Privacy Policy — RSends',
  description:
    'How RSends (Rpagos S.R.L) collects, uses, retains, and shares personal data. GDPR and Costa Rica Law 8968 disclosures.',
}

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Privacy Policy"
      title="How we handle your data"
      lastUpdated="April 25, 2026"
      breadcrumbLabel="Privacy"
    >
      <p>
        This Privacy Policy describes how Rpagos S.R.L (&quot;<strong>RSends</strong>&quot;,
        &quot;we&quot;, &quot;us&quot;) collects, uses, stores, and shares personal data when you
        use the RSends platform, dashboard, APIs, and related services (collectively, the
        &quot;<strong>Service</strong>&quot;).
      </p>

      <h2>1. Data Controller</h2>
      <p>
        The data controller responsible for your personal data is:
      </p>
      <p>
        <strong>Rpagos S.R.L</strong>
        <br />
        Registered in Costa Rica, registry no. 4062001345466
        <br />
        San José, Costa Rica
        <br />
        Contact: <a href="mailto:privacy@rsends.io">privacy@rsends.io</a>
      </p>

      <h2>2. Data we collect</h2>
      <p>We collect the following categories of personal data:</p>
      <ul>
        <li>
          <strong>Account information</strong> — name, email address, phone number, business name,
          tax identifiers, and authentication credentials.
        </li>
        <li>
          <strong>Identity verification (KYC) data</strong> — government-issued ID, proof of address,
          ultimate beneficial ownership records, and documentation supporting source of funds.
        </li>
        <li>
          <strong>Transaction data</strong> — wallet addresses, transaction hashes, amounts, source
          and destination chains, settlement records, fees, and counterparty references.
        </li>
        <li>
          <strong>Technical data</strong> — IP address, device type, browser fingerprint, cookie
          identifiers, log files, and approximate geolocation derived from IP.
        </li>
        <li>
          <strong>Communications</strong> — support tickets, emails, and any correspondence you
          send to us.
        </li>
      </ul>

      <h2>3. Legal basis for processing</h2>
      <p>We process your personal data on the following legal bases:</p>
      <ul>
        <li>
          <strong>Performance of a contract</strong> — to provide the Service, process transactions,
          and operate your account.
        </li>
        <li>
          <strong>Legal obligation</strong> — to comply with anti-money-laundering (AML),
          counter-terrorism-financing (CTF), DAC8 reporting (EU users), tax reporting, and
          sanctions-screening obligations.
        </li>
        <li>
          <strong>Legitimate interest</strong> — fraud prevention, network security, product
          improvement, and internal analytics.
        </li>
        <li>
          <strong>Consent</strong> — where required (for example, optional marketing
          communications), which you may withdraw at any time.
        </li>
      </ul>

      <h2>4. How we use your data</h2>
      <ul>
        <li>To open, maintain, and secure your account.</li>
        <li>To execute and settle transactions on the supported blockchains.</li>
        <li>To perform KYC, sanctions screening, and ongoing AML monitoring.</li>
        <li>To detect, prevent, and investigate fraud and abuse.</li>
        <li>To provide customer support and respond to your requests.</li>
        <li>To comply with applicable law and respond to lawful requests from authorities.</li>
      </ul>

      <h2>5. Data sharing</h2>
      <p>We share personal data only with:</p>
      <ul>
        <li>
          <strong>Service providers</strong> — KYC vendors, blockchain analytics partners, cloud
          hosting providers, and email/communication tools, all bound by data-processing
          agreements.
        </li>
        <li>
          <strong>Authorities and regulators</strong> — when required by law, court order, or in
          response to a lawful request, including under DAC8 information-exchange obligations.
        </li>
        <li>
          <strong>Successors</strong> — in connection with a merger, acquisition, or sale of
          assets, subject to equivalent privacy protections.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data and we do not share it with advertisers.
      </p>

      <h2>6. International transfers</h2>
      <p>
        We are headquartered in Costa Rica. Personal data of users located in the European Economic
        Area (EEA) or the United Kingdom is transferred to Costa Rica under the European
        Commission&apos;s Standard Contractual Clauses (SCCs), supplemented by appropriate technical
        and organisational safeguards.
      </p>

      <h2>7. Retention</h2>
      <p>
        We retain personal data for the duration of your account plus <strong>five (5) years</strong>{' '}
        following termination, in line with our record-keeping obligations under Costa Rican AML
        regulations and contractual commitments. Transaction records may be retained longer where
        required by law.
      </p>

      <h2>8. Your rights</h2>
      <p>Depending on your jurisdiction, you have the following rights:</p>
      <ul>
        <li>
          <strong>EEA / UK users (GDPR Articles 15–22)</strong> — access, rectification, erasure,
          restriction of processing, data portability, objection to processing, and the right not
          to be subject to solely automated decisions.
        </li>
        <li>
          <strong>Costa Rica users (Law 8968)</strong> — the rights of access, rectification,
          deletion (where permitted), and revocation of consent.
        </li>
      </ul>
      <p>
        To exercise these rights, contact{' '}
        <a href="mailto:privacy@rsends.io">privacy@rsends.io</a>. We will respond within the
        timeframes required by applicable law. Some rights may be limited where we are required to
        retain data for legal or regulatory reasons (for example, AML record-keeping).
      </p>
      <p>
        You also have the right to lodge a complaint with your local supervisory authority — in
        Costa Rica, the <em>Agencia de Protección de Datos de los Habitantes (PRODHAB)</em>; in the
        EEA, your national data protection authority.
      </p>

      <h2>9. Security</h2>
      <p>
        We apply technical and organisational measures designed to protect your data against
        unauthorised access, loss, alteration, or disclosure, including encryption in transit and
        at rest, access controls, segregation of duties, and continuous monitoring. No system is
        100% secure; we will notify you of a personal-data breach where required by law.
      </p>

      <h2>10. Cookies</h2>
      <p>
        For details about the cookies and similar technologies used on the Service, please see our{' '}
        <a href="/docs/cookies">Cookie Policy</a>.
      </p>

      <h2>11. Children</h2>
      <p>
        The Service is not directed to individuals under 18. We do not knowingly collect personal
        data from minors.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be communicated
        through the Service or by email. The &quot;Last updated&quot; date at the top of this page
        reflects the most recent revision.
      </p>

      <h2>13. Contact</h2>
      <p>
        Privacy enquiries: <a href="mailto:privacy@rsends.io">privacy@rsends.io</a>
        <br />
        Postal: Rpagos S.R.L, San José, Costa Rica.
      </p>
    </LegalShell>
  )
}
