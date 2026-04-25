import type { Metadata } from 'next'
import LegalShell from '../_components/LegalShell'

export const metadata: Metadata = {
  title: 'AML / KYC Notice — RSends',
  description:
    'Anti-Money-Laundering and Know-Your-Customer obligations applicable to RSends users, including FATF, EU DAC8, and Costa Rica AML/CFT framework.',
}

export default function AmlKycPage() {
  return (
    <LegalShell
      eyebrow="AML / KYC Notice"
      title="Anti-Money-Laundering and Know-Your-Customer programme"
      lastUpdated="April 25, 2026"
      breadcrumbLabel="AML / KYC"
    >
      <p>
        This Notice describes the anti-money-laundering (&quot;<strong>AML</strong>&quot;),
        counter-terrorism-financing (&quot;<strong>CTF</strong>&quot;), and customer-due-diligence
        obligations that Rpagos S.R.L (&quot;<strong>RSends</strong>&quot;) applies to all users
        of the Service. It is provided for transparency and forms part of our Terms of Service.
      </p>

      <h2>1. Compliance framework</h2>
      <p>RSends operates a risk-based compliance programme aligned with:</p>
      <ul>
        <li>
          The Recommendations of the <strong>Financial Action Task Force (FATF)</strong>, in
          particular Recommendation 15 on Virtual Asset Service Providers.
        </li>
        <li>
          <strong>EU Directive 2023/2226 (DAC8)</strong> for the automatic exchange of information
          on crypto-asset transactions for users tax-resident in the European Union.
        </li>
        <li>
          Costa Rica&apos;s AML/CFT framework, including <em>Ley 8204</em> and applicable
          regulations issued by SUGEF and the Instituto Costarricense sobre Drogas (ICD).
        </li>
        <li>
          International sanctions regimes, including <strong>OFAC</strong> (United States),
          consolidated United Nations sanctions, and EU restrictive measures.
        </li>
      </ul>

      <h2>2. Three-level customer screening</h2>
      <p>We apply a three-level approach to customer screening:</p>
      <ol>
        <li>
          <strong>Level 1 — Identity verification.</strong> Confirmation of identity using
          government-issued documents and a liveness check, sanctions and politically-exposed-
          person (PEP) screening, and basic risk scoring.
        </li>
        <li>
          <strong>Level 2 — Enhanced due diligence (EDD).</strong> Triggered for higher-risk
          profiles (high transaction volume, exposure to high-risk jurisdictions, complex
          ownership structures). Requires additional documentation, including source of funds,
          source of wealth, and ultimate beneficial ownership records.
        </li>
        <li>
          <strong>Level 3 — Continuous monitoring.</strong> Ongoing transaction monitoring against
          customer profiles, periodic re-verification, blockchain analytics screening of
          counterparties and wallet addresses, and risk-based reviews.
        </li>
      </ol>

      <h2>3. Customer Due Diligence (CDD) requirements</h2>
      <p>To open and maintain an account, you must provide:</p>
      <ul>
        <li>A valid government-issued photo identification document.</li>
        <li>Proof of residential address dated within the last three (3) months.</li>
        <li>
          For corporate users: certificate of incorporation, register of directors, register of
          shareholders, and identification of all ultimate beneficial owners holding 25% or more.
        </li>
        <li>
          A description of the intended use of the Service, expected transaction volumes, and
          counterparties.
        </li>
      </ul>
      <p>
        We may request additional information at any time as part of our risk-based monitoring
        obligations.
      </p>

      <h2>4. Source of funds</h2>
      <p>
        For transactions exceeding applicable thresholds, or where risk indicators suggest
        elevated risk, we may require documentation of the source of funds and source of wealth.
        Acceptable evidence includes employment records, business financial statements, sale-of-
        asset documentation, or audited corporate accounts. We may delay or decline transactions
        until satisfactory evidence is provided.
      </p>

      <h2>5. Sanctions screening</h2>
      <p>
        All users, beneficial owners, and counterparties (including counterparty wallet addresses)
        are screened against the OFAC SDN List, EU consolidated sanctions list, UN sanctions
        list, and additional national lists where relevant. Lists are refreshed at least daily,
        and screening is repeated continuously throughout the customer lifecycle.
      </p>
      <p>
        Transactions involving sanctioned persons, sanctioned wallet addresses, or sanctioned
        jurisdictions will be blocked and reported to the relevant authorities as required.
      </p>

      <h2>6. Suspicious-activity reporting</h2>
      <p>
        Where transactions or behaviour suggest possible money laundering, terrorism financing,
        sanctions evasion, fraud, or other financial crime, we will file an internal Suspicious
        Activity Report (SAR) and, where required, escalate to the Costa Rican Financial
        Intelligence Unit and to other competent authorities. We may not be permitted to inform
        you that a report has been filed (&quot;tipping-off&quot;).
      </p>

      <h2>7. Record keeping</h2>
      <p>
        We retain customer-due-diligence records, transaction records, and AML monitoring records
        for a period of at least <strong>five (5) years</strong> from the end of the business
        relationship or from the date of the transaction, in accordance with Costa Rican
        regulations.
      </p>

      <h2>8. Customer cooperation</h2>
      <p>By using the Service you agree to:</p>
      <ul>
        <li>Provide accurate, complete, and up-to-date information.</li>
        <li>
          Respond promptly to compliance requests, including documentation requests and source-
          of-funds verifications.
        </li>
        <li>
          Notify us promptly of changes to your beneficial ownership, control, or registered
          address.
        </li>
        <li>Not use the Service to evade compliance controls or in connection with sanctioned activity.</li>
      </ul>
      <p>
        Failure to cooperate may result in suspension or termination of your account and, where
        appropriate, reporting to authorities.
      </p>

      <h2>9. Risk-based approach</h2>
      <p>
        Our compliance programme is risk-based and proportionate. The level of due diligence,
        monitoring, and review applied to a relationship depends on the assessed risk, taking
        into account customer type, geography, products used, transaction patterns, and external
        risk indicators.
      </p>

      <h2>10. Changes to this Notice</h2>
      <p>
        We update this Notice from time to time as the regulatory landscape evolves. The
        &quot;Last updated&quot; date at the top of this page reflects the most recent revision.
      </p>

      <h2>11. Contact</h2>
      <p>
        Compliance enquiries: <a href="mailto:compliance@rsends.io">compliance@rsends.io</a>
        <br />
        Postal: Rpagos S.R.L, Compliance Office, San José, Costa Rica.
      </p>
    </LegalShell>
  )
}
