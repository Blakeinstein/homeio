# Security Policy

Homeio runs with a lot of reach into the host: the Docker socket, files under `FILES_ROOT`, a terminal, disks, network and power. A bug in it can be a bug in the whole machine, so security reports are taken seriously and handled before anything else.

## Supported Versions

Fixes land on `main` and ship in the next release. Only the latest release gets security fixes; there are no backports to older versions.

| Version | Supported |
|---|---|
| Latest release ([releases](https://github.com/doctor-io/homeio/releases)) and `ghcr.io/doctor-io/homeio:latest` | Yes |
| Anything older | No — update first, then check whether the issue still reproduces |

## Reporting a Vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:

1. Go to [Security → Report a vulnerability](https://github.com/doctor-io/homeio/security/advisories/new).
2. Describe what you found and include:
   - the Homeio version (Settings → General → Homeio Version, or the image tag) and how it is installed (Docker, install script, bare metal);
   - the steps to reproduce, or a proof of concept;
   - what an attacker needs first (network access only, a logged-in session, local shell on the host…);
   - what they get (read files, run commands, take over the host…).

The report stays private between you and the maintainer until a fix is published.

## What Happens Next

Homeio is maintained by one person, so these are targets, not guarantees:

- **Within 7 days:** an acknowledgement that the report arrived.
- **Within 14 days:** an assessment — whether it is confirmed, how severe it is, and the plan.
- **Within 90 days:** a fix released, sooner for anything critical.

Once the fix ships, a GitHub Security Advisory is published with the affected and fixed versions, and a CVE is requested when it applies. You are credited in the advisory unless you would rather not be. Please keep the details private until then; if the 90 days run out without a fix, we will agree on a disclosure date together.

## Scope

Homeio is built for a single trusted owner on a LAN, a tailnet, or behind a TLS reverse proxy. The full threat model is in [doc/security.md](./doc/security.md). In short:

**In scope** — for example:

- Anything that works **without logging in**: auth bypass, session forgery, reaching `/api/v1/**` or the terminal WebSocket unauthenticated, getting past two-factor authentication.
- Reading or writing outside `FILES_ROOT`, in the app or in the upload sidecar.
- Cross-site attacks (XSS, CSRF, WebSocket hijacking) that let another site act as the logged-in owner.
- Leaking secrets: `AUTH_SESSION_SECRET`, password hashes, stored OAuth client secrets or Google Drive tokens.
- Crossing the D-Bus helper or upload sidecar privilege boundary.
- Problems in the install script, the Docker image or `docker-compose.yml` as shipped.

**Out of scope:**

- Things the owner can already do on purpose. A logged-in owner can open a shell, run any container, and format disks; that is the product, not a vulnerability.
- Deployments that ignore the documented setup: the default `AUTH_SESSION_SECRET` left in place, or Homeio exposed to the internet without TLS.
- Denial of service that needs sustained flooding from the local network.
- CVEs in dependencies or the base image without a way to exploit them through Homeio. The published image is already scanned every week; open a normal issue for those.
- Findings from automated scanners with no proof of impact.

When in doubt, report it privately anyway.
