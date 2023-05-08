# Security Policy

## Bug Bounty Program

Threshold Network has a [Bug Bounty program with Immunefi](https://immunefi.com/bounty/thresholdnetwork/).

The details for the Bug Bounty are maintained and updated at the [Immunefi dedicated space to Threshold](https://immunefi.com/bounty/thresholdnetwork/). There you can explore the assets in scope of the Bounty and the different rewards by threat level. As a guide, the initial bounty program launched with the following rewards according to the severity of the threats found:

Smart Contracts
- Critical Level: USD $100,000 to USD $500,000
- High Level: USD $10,000 to USD $50,000
- Medium Level: USD $1,000 to USD $5,000
- Low Level: USD $1,000

Websites and Applications
- Critical Level: USD $10,000 to USD $25,000
- High Level: USD $1,000 to USD $10,000
- Medium Level: USD $1,000

A great place to begin your research is by working on our testnet. Please see our [documentation](https://docs.threshold.network) to get started. We ask that you please respect network machines and their owners. If you find a vulnerability that you suspect has given you access to a machine against the owner's permission, stop what you're doing and create a report using the immunefi dashboard for researchers.

### Out of Scope Impacts

Please note that the following impacts and attack vectors are excluded from rewards for the Immunefi bug bounty program:

General: 
- Attacks that the reporter has already exploited themselves, leading to damage
- Attacks requiring access to leaked keys/credentials
- Attacks requiring access to privileged addresses (governance, strategist), except in such cases where the contracts are intended to have no privileged access to functions that make the attack possible
- Broken link hijacking

Smart Contracts and Blockchain/DLT: 
- Basic economic governance attacks (e.g. 51% attack)
- Lack of liquidity
- Best practice critiques
- Sybil attacks
- Centralization risks

Websites and Apps: 
- Theoretical impacts without any proof or demonstration
- Content spoofing / Text injection issues
- Self-XSS
- Captcha bypass using OCR
- CSRF with no security impact (logout CSRF, change language, etc.)
- Missing HTTP Security Headers (such as X-FRAME-OPTIONS) or cookie security flags (such as “httponly”)
- Server-side information disclosure such as IPs, server names, and most stack traces
- Vulnerabilities used to enumerate or confirm the existence of users or tenants
- Vulnerabilities requiring unlikely user actions
- Lack of SSL/TLS best practices
- Attacks involving DOS and/or DDoS
- Attacks that require physical contact to the victims computer and/or wallet
- Attacks requiring privileged access from within the organization
- SPF records for email domains
- Feature requests
- Best practices

Rewards are distributed according to the impact of the vulnerability based on the [Immunefi Vulnerability Severity Classification System V2.2](https://immunefi.com/immunefi-vulnerability-severity-classification-system-v2-2/). This is a simplified 5-level scale, with separate scales for websites/apps, smart contracts, and blockchains/DLTs, focusing on the impact of the vulnerability reported. 


## Reporting a Vulnerability Not Covered by the Bug Bounty Program

Security researchers are encouraged to submit issues outside of the outlined Impacts and Assets in Scope. If you can demonstrate a critical impact on code in production for an asset not in scope, Threshold DAO encourages you to submit your bug report using the “primacy of impact exception” asset in Immunefi.

Threshold DAO will try to make an initial assessment of a bug's relevance, severity, and exploitability, and communicate this back to the reporter. The Threshold DAO will compensate important findings on a case-by-case basis. We value security researchers and we encourage you to contact us to discuss your findings.

We also ask all researchers to please submit their reports in English.

