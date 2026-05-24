# Jimmikub Timer

A small static timer for Rummikub rounds, built for mobile use.

## Features

- Active and not-playing player management
- Counterclockwise seat-order chart
- First-player selection per round
- Preset and custom turn lengths
- Tap-to-advance timer
- Audio cues at time milestones and time-up

## Local Preview

Run a static server from this folder:

```sh
python3 -m http.server 8080 --bind 0.0.0.0
```

Then open the LAN URL from a phone on the same Wi-Fi.

## GitHub Pages

This site is static and can be served directly from the repository root.

1. Push the repository to GitHub.
2. In GitHub, open Settings -> Pages.
3. Set the source to deploy from the `main` branch and `/ (root)`.
4. Keep the custom domain set to `jimmikub.duckdns.org`.

The `CNAME` file in this repo configures the custom domain for GitHub Pages.
