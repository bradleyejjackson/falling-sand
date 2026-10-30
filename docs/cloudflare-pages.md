# Hosting on Cloudflare Pages (sand.bradleyejjackson.com)

The repo builds the same static site for GitHub Pages and Cloudflare Pages: `node tools/pages.js _site` writes `_site/index.html` plus `_site/_headers`. Cloudflare reads `_headers` and sends COOP/COEP, so the page is cross-origin isolated and the sim runs on the worker pool instead of the serial main-thread path. GitHub Pages keeps working unchanged until you turn it off.

## One-time setup in the Cloudflare dashboard

1. Sign in at https://dash.cloudflare.com and go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorise GitHub and pick the `bradleyejjackson/falling-sand` repository.
3. Build settings:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `node tools/pages.js _site`
   - Build output directory: `_site`
   - Root directory: leave blank
4. **Save and Deploy.** The first build takes about a minute and gives you a `*.pages.dev` URL. Open it and check the game runs.
5. In the new project, open **Custom domains → Set up a custom domain**, enter `sand.bradleyejjackson.com`, and confirm.
   - If `bradleyejjackson.com` already uses Cloudflare DNS, Cloudflare adds the `CNAME sand → <project>.pages.dev` record for you.
   - If the domain's DNS is elsewhere, add that CNAME record at your DNS provider yourself (Cloudflare shows the exact target), then wait for it to verify.
   - The HTTPS certificate is issued automatically, usually within a few minutes.

After this, every push to `main` redeploys both sites, and every pull request gets its own preview URL on Cloudflare.

## Checking it worked

Open https://sand.bradleyejjackson.com, open the browser console, and type `crossOriginIsolated`. It should print `true`. (On GitHub Pages it prints `false` unless the coi-serviceworker shim is in place.)

## Switching off GitHub Pages (optional, later)

Once you're happy with the Cloudflare site: repo **Settings → Pages → Source → None** (or delete `.github/workflows/pages.yml`), and update the link in the README.
