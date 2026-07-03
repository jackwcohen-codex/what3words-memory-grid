# what3words Memory Grid

A small browser memory game using the what3words API.

The player studies three highlighted what3words grid squares, then clicks the square that matches a shown three-word address. Scoring is based on how many grid squares away the clicked square is.

## Features

- Leaflet map UI
- what3words grid overlay
- Three-square memory sequence
- Easy, Normal, and Hard difficulty levels
- Grid-square-distance scoring
- Server-side what3words API proxy so the API key is not exposed in browser code

## Local Run

Set your API key, then start the server:

```powershell
$env:WHAT3WORDS_API_KEY="your_api_key_here"
npm start
```

Open:

```text
http://localhost:5173
```

## Render Deployment

Create a Render Web Service from this GitHub repository.

Use:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Add this environment variable in Render:

```text
WHAT3WORDS_API_KEY
```

Do not commit the real API key to GitHub.
