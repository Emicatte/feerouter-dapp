import type { Metadata } from 'next'
import LegalShell from '../_components/LegalShell'

export const metadata: Metadata = {
  title: 'Terms of Service — RSends',
  description:
    'The terms governing your use of the RSends custodial multi-chain payment gateway provided by Rpagos S.R.L (Costa Rica).',
}

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Terms of Service"
      title="Terms of Service"
      lastUpdated="April 25, 2026"
      breadcrumbLabel="Terms"
    >
      <p>
        These Terms of Service (the &quot;<strong>Terms</strong>&quot;) form a binding agreement
        between you (the &quot;<strong>Customer</strong>&quot;) and{' '}
        <strong>Rpagos S.R.L</strong> (&quot;<strong>RSends</strong>&quot;, &quot;we&quot;,
        &quot;us&quot;), a company registered in Costa Rica (registry no. 4062001345466), with
        offices in San José, Costa Rica.
      </p>
      <p>
        By creating an account, accessing the dashboard, or using any RSends API, you agree to be
        bound by these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        RSends provides a <strong>custodial multi-chain payment gateway</strong> that enables
        merchants to accept stablecoin payments across supported public blockchains
        (currently Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Tron, and
        Solana) and receive periodic settlements in USDT. Specific features, supported networks,
        and limits may change over time.
      </p>

      <h2>2. Eligibility</h2>
      <p>You may use the Service only if:</p>
      <ul>
        <li>You are at least 18 years of age and have legal capacity to enter into contracts.</li>
        <li>
          You are not a resident of, or located in, a jurisdiction subject to comprehensive
          sanctions administered by OFAC, the United Nations, or the European Union.
        </li>
        <li>
          You are not listed on, or owned or controlled by a person listed on, any applicable
          sanctions list.
        </li>
        <li>
          You are not legally barred from using payment, custody, or virtual-asset services in your
          jurisdiction.
        </li>
      </ul>

      <h2>3. Account & KYC</h2>
      <p>
        To use the Service you must register an account and complete identity verification. You
        agree to provide accurate, current, and complete information and to keep it up to date.
        Additional information may be requested at any time pursuant to our{' '}
        <a href="/docs/aml-kyc">AML/KYC Notice</a>. We may suspend or terminate accounts where KYC
        cannot be completed or where information appears false or misleading.
      </p>
      <p>
        You are responsible for maintaining the confidentiality of your credentials and for all
        activity under your account. Notify us immediately of any suspected unauthorised access.
      </p>

      <h2>4. Custodial nature of the Service</h2>
      <p>
        RSends is a <strong>custodial</strong> service: between the moment a customer payment is
        received on-chain and the moment of settlement, the relevant funds are held by Rpagos
        S.R.L on your behalf. You acknowledge and accept that:
      </p>
      <ul>
        <li>
          You do not control the private keys to the receiving wallets and you have no direct
          on-chain access to held balances.
        </li>
        <li>
          Funds held in custody are recorded as your entitlement on our books and records and are
          segregated from RSends&apos; operating funds.
        </li>
        <li>
          Custody is subject to operational, technical, and counterparty risks inherent in
          blockchain infrastructure.
        </li>
      </ul>

      <h2>5. Settlement</h2>
      <p>
        Settlements are paid out in <strong>USDT</strong> on a <strong>weekly</strong> cycle, with
        an initial <strong>three (3) day</strong> hold on the first settlement to a newly added
        payout address for fraud-prevention purposes. Settlement timing may be extended where
        compliance review is required.
      </p>

      <h2>6. Fees</h2>
      <p>
        Fees applicable to the Service are set out on our pricing page and may be amended from
        time to time. Fees are deducted from settlements unless otherwise agreed in writing. We
        will provide reasonable advance notice of any material fee changes.
      </p>

      <h2>7. Prohibited activities</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>
          Process payments related to unlawful gambling, illegal goods or services, intellectual
          property infringement, or any activity prohibited by applicable law.
        </li>
        <li>Send funds to or from mixers, tumblers, darknet markets, or sanctioned addresses.</li>
        <li>Engage in market manipulation, fraud, or money laundering.</li>
        <li>
          Circumvent transaction limits, identity verification, or other compliance controls.
        </li>
        <li>
          Use the Service to facilitate transactions for, or on behalf of, sanctioned persons or
          jurisdictions.
        </li>
      </ul>
      <p>
        We may freeze, reverse, or refuse transactions that we reasonably believe violate these
        Terms or applicable law, and we may report such transactions to authorities as required.
      </p>

      <h2>8. Customer obligations</h2>
      <ul>
        <li>Comply with all applicable laws, including AML, sanctions, tax, and consumer-protection laws.</li>
        <li>Provide accurate transaction descriptions and customer information when requested.</li>
        <li>Maintain adequate records of your own.</li>
        <li>Cooperate promptly with reasonable compliance requests.</li>
      </ul>

      <h2>9. Disclaimers</h2>
      <p>
        The Service is provided &quot;<strong>as is</strong>&quot; and &quot;<strong>as
        available</strong>&quot;. To the maximum extent permitted by law, we disclaim all
        warranties, express or implied, including merchantability, fitness for a particular
        purpose, and non-infringement. We do not warrant that the Service will be uninterrupted,
        error-free, or free of harmful components. Stablecoin and blockchain operations are
        subject to risks (volatility, depeg, network congestion, smart-contract risk) that we do
        not control.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, RSends&apos; aggregate liability for all claims
        arising out of or relating to the Service is limited to the fees you paid to us in the
        twelve (12) months preceding the event giving rise to the claim. We will not be liable for
        indirect, incidental, special, consequential, or punitive damages, or for lost profits,
        revenue, data, or business opportunities.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You agree to indemnify and hold harmless RSends and its officers, directors, employees,
        and agents from any claim, demand, or damage, including reasonable legal fees, arising out
        of your breach of these Terms, your violation of applicable law, or your misuse of the
        Service.
      </p>

      <h2>12. Termination</h2>
      <p>
        Either party may terminate the agreement on <strong>thirty (30) days&apos;</strong> written
        notice. We may suspend or terminate immediately where required by law, where we suspect
        fraud or breach of these Terms, or where continued provision of the Service would expose
        us to legal or regulatory risk. On termination we will release any remaining balance to
        you, subject to applicable holds and compliance review. Records will be retained for
        five (5) years post-termination as required by law.
      </p>

      <h2>13. Governing law &amp; dispute resolution</h2>
      <p>
        These Terms are governed by the laws of <strong>Costa Rica</strong>, without regard to
        conflict-of-laws principles. Any dispute arising out of or relating to these Terms shall
        be finally settled by <strong>arbitration</strong> seated in San José, Costa Rica, in
        accordance with the rules of the Centro Internacional de Conciliación y Arbitraje
        (CICA), in the Spanish or English language as the parties agree.
      </p>

      <h2>14. Changes to these Terms</h2>
      <p>
        We may amend these Terms from time to time. We will notify you of material changes
        through the Service or by email. Your continued use of the Service after the effective
        date of the change constitutes your acceptance of the revised Terms.
      </p>

      <h2>15. Contact</h2>
      <p>
        Legal enquiries: <a href="mailto:legal@rsends.io">legal@rsends.io</a>
        <br />
        Postal: Rpagos S.R.L, San José, Costa Rica.
      </p>
    </LegalShell>
  )
}
