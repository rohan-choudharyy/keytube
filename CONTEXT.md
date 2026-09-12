# keytube

Fast full-keyboard control for YouTube in the browser.

## Language

**Feed**:
A scrollable list of videos on home, search, channel, or playlist pages.
_Avoid_: timeline, grid, results

**Watch-next**:
The up-next rail of videos on the watch page.
_Avoid_: timeline, suggestions, sidebar

**Player**:
The watch-page video element plus its controls.
_Avoid_: movie_player, video tag

**Hint Mode**:
Armed state where digit keys select videos instead of seeking.
_Avoid_: hint overlay, selection mode

**Badge**:
The number label shown on a selectable video while in Hint Mode.
_Avoid_: hint, marker, overlay

**Chord**:
Two keys pressed in sequence where the first arms the second, e.g. g then h.
_Avoid_: shortcut, hotkey, combo

**Page**:
A group of up to 9 Badges shown at once while in Hint Mode.
_Avoid_: sheet, batch, set
