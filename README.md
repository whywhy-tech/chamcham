# Chameleon Hunt

An original multiplayer hide-and-paint prototype inspired by arcade hide-and-seek games.

## Features

- Create a private room code
- Join by room code
- One hunter, multiple hiders
- Hiders paint themselves to blend into surfaces
- Hiders can sample nearby wall/crate/floor colors
- Hunter uses a harmless tag blaster
- Round timer, hiding phase, win conditions
- Online-ready Node.js + Socket.IO server

## Run locally

Install Node.js 18 or newer.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

To test multiplayer locally, open the same URL in two browser tabs. Create a room in one tab and join the code in the other.

## Controls

### Everyone

- WASD / Arrow keys: move

### Hider

- Color picker + Paint Self: change body color
- Sample Nearby Surface: copy nearby object color
- E: sample and paint
- F: freeze pose
- Shift: crouch

### Hunter

- Click: tag a hider with the tag blaster

## Deploy free on Render

1. Create a GitHub repository.
2. Upload all these project files.
3. Go to Render.
4. New > Web Service.
5. Connect your GitHub repository.
6. Use these settings:
   - Runtime: Node
   - Build Command: npm install
   - Start Command: npm start
7. Deploy.
8. Open the Render URL and share it with friends.

Important: on Render's free tier, the server can sleep when nobody is playing. The first player may wait while it wakes up.

## Notes

This is a prototype. For a bigger game, add proper collision, mobile controls, accounts, anti-cheat, better maps, animations, sound, and cosmetics.
