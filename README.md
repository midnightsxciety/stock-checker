# Disney Store UK Stock Checker

Checks configured Disney Store UK product pages every 5 minutes via GitHub
Actions, and sends a push notification to your iPhone via ntfy.sh when an
item comes into stock.

## Setup (one-time)

### 1. Get the ntfy app on your iPhone
- Install **ntfy** from the App Store (free, no account needed)
- Open the app → tap "+" → subscribe to a topic name of your choosing
  - Pick something private/hard-to-guess, e.g. `lewis-disney-stock-a8f3k`
  - Anyone who knows this exact topic name could see your notifications, since
    ntfy.sh topics are not access-controlled by default — that's why a random
    suffix matters

### 2. Create a GitHub repo
- Push this folder to a new **public or private** GitHub repo
  (private is fine — Actions still works, just uses your free minutes quota,
  which is generous enough for this)

### 3. Add your ntfy topic as a repo secret
- In your GitHub repo: Settings → Secrets and variables → Actions → New repository secret
- Name: `NTFY_TOPIC`
- Value: the topic name you picked in step 1 (e.g. `lewis-disney-stock-a8f3k`)

### 4. Enable Actions
- Go to the "Actions" tab in your repo → enable workflows if prompted
- The workflow will now run automatically every 5 minutes
- To test immediately: Actions tab → "Check Disney Store Stock" → "Run workflow"

## Adding more products or retailers

Edit `checker.js` and add entries to the `targets` array at the top:

```js
{
  name: "Some Other Item",
  url: "https://www.disneystore.co.uk/some-other-item.html",
  parser: disneyDefaultParser,
}
```

For a different retailer, you'll likely need a different `parser` function,
since each site's HTML/JSON structure differs. The `parser` just needs to
take the fetched HTML/JSON as a string and return `{ inStock: true/false, reason: "..." }`.

## Notes & limitations

- This checks page HTML for phrases like "Add to Bag" vs "Coming Soon" /
  "Notify Me" / "Sold Out". If Disney Store UK redesigns their site, this
  logic may need updating — check the Action's logs (Actions tab → click a
  run → "Run stock checker" step) if notifications stop working correctly.
- GitHub Actions' schedule is a minimum interval, not a guarantee — busy
  periods may delay runs by a few minutes.
- Be mindful of request frequency; this is set to check every 5 minutes
  with a 1.5s pause between multiple targets, to avoid hammering the site.
- State is stored in `state.json` and committed back to the repo after each
  run, so notifications only fire on the *transition* to in-stock (not every
  single run while it stays in stock).
