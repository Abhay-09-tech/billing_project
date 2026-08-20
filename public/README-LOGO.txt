HOW TO ADD YOUR LOGO
====================

1. Save your logo file into THIS folder, named exactly:

       logo.svg          (best - stays sharp at any size)
   or  logo.png          (fine - use 512x512 or larger, transparent background)

2. Save the same artwork over  favicon.svg  in this folder, so the browser
   tab and the phone home-screen icon match.

3. Run:  npm run dev        (to see it locally)
   or:   git add -A && git commit -m "Add logo" && git push
                            (to publish it to the live site)

That's it. The logo appears automatically in:
   - the sidebar
   - the mobile top bar
   - the login screen
   - the connect screen

No code changes needed. The app looks for logo.svg first, then logo.png, and
falls back to a plain placeholder mark if neither is present.

Your logo is never stretched or distorted: it is centred inside a square box
at its own aspect ratio, with clear space around it.
