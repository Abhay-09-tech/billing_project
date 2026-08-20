LOGO ASSET REQUIRED
===================

The application expects ONE complete logo image containing the entire
lock-up: the mark AND the words "Perfect vision", "BILLING SOFTWARE" and
"SMART BILLING. CLEAR VISION."

Save your logo into THIS folder, named exactly:

    perfect-vision-billing-logo.png

A .webp or .svg of the same name also works.

Recommended: transparent background, around 1200px wide.

Then run:
    npm run dev                                   (see it locally)
or:
    git add -A && git commit -m "Add logo" && git push     (publish it)

It then appears automatically in:
    - the connect screen
    - the login screen
    - the sidebar
    - the mobile header
    - the browser tab icon
    - the installed app icon

No code changes are needed anywhere.

UNTIL THAT FILE EXISTS, the product name shows as plain text. That is a
deliberate missing-asset state, not a substitute logo - no icon is drawn,
so it stays obvious that the artwork has not been supplied yet.

The image is never cropped or stretched: it renders at its own aspect
ratio, capped at 220px wide (max 70% of screen) on entry screens, with no
container or background behind it.
