# Security Policy

## Supported versions

PepeteX is under active, AI-assisted ("vibecoded") development and is provided **as-is, with no warranty**. Only the latest `main` branch receives security fixes. Please make sure you are running the most recent version before reporting an issue.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| older   | :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately so we can investigate and ship a fix before details become public:

1. Go to the repository's **Security → Advisories** tab and choose **"Report a vulnerability"** (GitHub Private Vulnerability Reporting), **or**
2. Email the maintainers at `<INSERT-SECURITY-CONTACT-EMAIL>`.

Please include as much detail as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept, affected endpoints/components)
- The version or commit you tested against
- Any suggested remediation, if you have one

## What to expect

- **Acknowledgement** within 5 business days.
- An initial assessment and severity classification shortly after.
- Regular updates on remediation progress.
- Public disclosure (and credit, if you wish) once a fix is available.

## Scope

This project is self-hosted and depends on operator-supplied configuration — AI provider keys, object storage, and database credentials. Misconfiguration of your own deployment (exposed `.env`, public object storage, weak credentials) is outside the scope of this policy, but we're happy to receive documentation improvements that help others avoid those pitfalls.

Thank you for helping keep PepeteX and its users safe.
