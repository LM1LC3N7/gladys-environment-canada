# TODO

## Before the first release

- [ ] Check the CI (Docker build, Node 22 and 24).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Run the store validator once the image is published.
- [ ] Test on a real Gladys 5.1+: widgets rendering, scene triggers in the
      editor, radar in the weather widget, alert nudges.

## To check when it happens

- [ ] An AQHI forecast with `aqhi_insmoke` (wildfire season): the shape was
      read from the API schema, never seen filled (2026-10).
- [ ] An AQHI observation with `special_notes_*`: shown nowhere yet.
- [ ] The time zone borders of `src/timezone.js` against real houses near a
      border (Lloydminster, East Kootenay, Magdalen Islands).

## Ideas

- [ ] Persist the last snapshot in `/data` so a restart during an outage
      still serves the weather.
- [ ] Québec's own air quality index (IQA, RSQA Montréal): the AQHI of
      Montréal and Québec City is a forecast only.
- [ ] Pollen? ECCC publishes none; a provincial source would be needed.
- [ ] Nowcast-like "rain in the next hour" trigger from the radar.
- [ ] Hydrometric data (`hydrometric-realtime`): river level near the house,
      spring floods.
