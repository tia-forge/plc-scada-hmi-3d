# PLC_SCADA_HMI · 3D control scene

Single-file three.js scene derived from the TiaLink project `PLC_SCADA_HMI`.

## Deliverable

`../PLC_SCADA_HMI_3D.html` — open it directly in a browser. three.js r150 is inlined,
all geometry and textures (HMI screen, labels, safety stripes, particle sprite) are
generated procedurally; there are no network requests or external assets.

## Controls

- Drag = orbit, wheel = zoom, right-drag / Shift+drag = pan
- Toolbar or the 3D control panel: START / STOP / AUTO / MANUAL / E-STOP / RESET
- HMI screen: click the top tabs (MAIN PART / PID / ERROR STATUS) or click the screen
- Right panel: inject SIM_* faults, Repair all, manual jog, PID setpoint
- Space = start/stop, A = auto, M = manual, E = e-stop, R = reset, H = next HMI screen
- Append `#auto` to the URL to start the line automatically

## Rebuild

```bash
python3 build.py
```
Edit `app.js` / `template.html`, then run the command above.
