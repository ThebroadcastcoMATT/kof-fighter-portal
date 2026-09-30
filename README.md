# Knees of Fury: fighter portal

A web page where the promoter checks and fills in every fighter on the card (photo, record, gym, country,
nickname, age, weight). It's a grid grouped by bout, with a status on each fighter: complete, needs info or
nothing yet. It is open: anyone with the link can view and edit. Each change records the name typed at the top.

- **Data:** Supabase tables `fn_fighters` and `fn_bouts`, plus the `fight-photos` storage bucket (set up by
  `supabase/migrations/002_fight_night.sql` in the Graphics-app repo).
- **Photos:** uploads go to `fight-photos/raw/`. The **Cut out new fighter photos** workflow (every 15 minutes)
  removes the background, frames every fighter the same way (face-anchored 4:5, head to waist) and grades them
  to match, then saves the result to `fight-photos/cut/`.
- **Graphics:** the Fight Night Graphics app pulls everything in with **Setup → Sync from online portal**.

Source of truth for these files: `fight/portal/` in the Graphics-app repo.
