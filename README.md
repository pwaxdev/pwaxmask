# pwaxMask  

**From `-0` to Big.js: all your numeric input edge cases covered.**  

`pwaxMask` is a **feature-rich JavaScript library for numeric input masking and formatting**.  
It goes beyond simple input masks, offering a complete toolkit for building professional, locale-aware numeric fields.  

With `pwaxMask`, you can confidently handle edge cases like **`-0`**, **localized grouping**, **high-precision math with Big.js**, **advanced rounding modes**, and even **custom presets** for clean, declarative HTML.  

---

## Key features  

- **Locale-aware formatting**  
  Automatic decimal and thousands separators via `Intl`.  

- **Advanced rounding modes**  
  Half-up, half-down, half-even (bankers), truncation, ceil/floor, etc.  

- **Flexible presets system**  
  Define reusable configurations once (e.g., currency, percentage, business rules) and keep your HTML clean:  
  ```html
  <input data-preset="myPreset">
  ```  

- **Grouping styles (standard, Indian, or custom)**  
  Built-in `groupStyle: 'standard'` → `1,234,567` and `groupStyle: 'indian'` → `12,34,567`.  
  Need something bespoke? Use a **custom pattern** like `[3,2,2]`.  

- **Big.js integration**  
  Ready for high-precision math beyond native `Number`.  

- **Rich input behavior**  
  Step handling, clamping, signed zeros, percentage/permille/basis-points units.  

- **Advanced copy & paste and controls**  
  Smart paste handling, arrow up/down with acceleration, PageUp/PageDown for larger steps, and mouse-wheel increments (when enabled).  

- **Digit normalization**  
  Converts non-Latin digits (Arabic, Persian, Devanagari, Bengali, Tamil, Khmer, Thai, Lao…) into ASCII `'0'..'9'` for consistent parsing.  

- **Empty value policies**  
  Decide what `getValue()` returns when the field is empty: `0`, `null`, or `''`.  

- **Prefix / suffix control**  
  Add symbols (e.g., `"€ "` or `" %"`) before or after the number.  

- **Sign position & style**  
  Place the sign before or after the prefix, or use accounting-style parentheses.  

- **Minus key behavior**  
  Choose between always-negative or toggle mode.  

- **Dual decimal separator input**  
  Allow both `.` and `,` when unambiguous.  

- **Percent parsing modes**  
  Handle `%` during paste/parse: `off`, `auto`, or `symbolOnly`.  

- **Clamping strategies**  
  Apply clamping always, only on blur, or not at all; also applies on paste.  

- **Focus-based behaviors**  
  Auto-select on focus, select once, or select only the decimal part.  

- **Live min/max enforcement**  
  Strategies: none, lenient, or strict.  

- **Raw value access**  
  Show the unformatted value on focus, copy raw value with Ctrl/Cmd+C.  

- **Accessibility (ARIA)**  
  Fine-tune aria-invalid persistence, error message durations, and aria-valuetext.  

- **Mobile-friendly input**  
  Control `inputmode` dynamically (numeric, text, decimal), with forced modes when needed.  

- **Validation & schema**  
  Define declarative constraints (`multipleOf`, `allowedRange`, `disallow`, `customMessage`).  

- **Units & scaling**  
  Built-in support for `%`, ‰, ‱, basis points, with configurable `unitFactor` and `unitDisplay`.  

- **Validation modes**  
  Hard blocking (`block`) or soft visual-only feedback.  

- **Undo/redo history**  
  Configurable stack with safe, non-destructive revert.  

- **Locking state**  
  Temporarily lock/unlock an element with optional opacity dimming and lock icon.  

- **Custom signs & symbols**  
  Replace `-` or `+` with any Unicode symbol (single or multi-codepoint).  

- **Info & error messaging**  
  Emit events for inline help or validation errors.  

- **Plugin architecture**  
  Extend core behavior with custom plugins (e.g., transform paste, post-format tweaks).  

- **MutationObserver auto-attach**  
  Automatically bind to new DOM nodes.  

- **Declarative configuration**  
  Control everything via JS options or HTML `data-*` attributes.  

---

## Getting started  

A full manual with detailed guides and live examples will be available soon.  
Stay tuned at [**pwax.dev**](https://pwax.dev)  

---

## License  

MIT License  
