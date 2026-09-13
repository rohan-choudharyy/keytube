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
A navigation Binding of one or two presses; a two-press Chord fires only after its leader, e.g. g then h.
_Avoid_: shortcut, hotkey, combo

**Action**:
A remappable keytube behavior, e.g. arming Hint Mode or going back in history.
_Avoid_: command, shortcut, hotkey

**Binding**:
The key or modifier combo assigned to an Action, e.g. Enter or Ctrl+K.
_Avoid_: shortcut, hotkey, combo

**Tour**:
The first-install slideshow inside the popup that explains Hint Mode, Chords, and which Bindings are remappable vs fixed. Shown once; no replay.
_Avoid_: onboarding, tutorial, help page

**Support Card**:
The highlighted Ko-fi strip in the popup and the last Tour slide inviting support.
_Avoid_: donate card, donation page, banner, ad
