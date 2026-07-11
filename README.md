# Stock Checker

Checks configured Disney Store UK product pages every 5 minutes via GitHub
Actions, and sends a push notification to your iPhone via ntfy.sh when an
item comes into stock.

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
