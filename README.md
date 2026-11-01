# easy-agent-chrome

Chrome extension companion to [easy-agent](https://github.com/MakeItEasyAI/easy-agent).
It fills web forms **in your normal Chrome**, where you are already signed in,
so it works on sites that block remote-controlled browsers (like Google).

⚠️ **Status:** early scaffold. The popup (manual Fill / List fields) works now.
The connection to the C++ agent (native messaging) is the next step.

## How it fits together

```
easy (C++ agent)  ──native messaging (private pipe, no port)──►  this extension  ──►  the web page
   plans, safety,                                                 fills fields,
   asks you [y/N]                                                 clicks (never Submit)
```

The extension never:
- clicks Submit / Send / Pay / Apply — you review and submit yourself
- types into password / OTP / card fields
- runs any value as code (values are treated as text)

## Try it now (manual, no agent needed)

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Open a form (e.g. a Google Form you can access).
3. Click the extension icon, type a field label and a value, click **Fill**.
4. Review the form and submit it yourself.

## Next

- Add a "native host" mode to the `easy` agent so it can drive this extension
  (see `native-host/README.md`).
- Then: `easy learn "fill this form from my resume"` fills the page in your
  normal Chrome.

## License

MIT — see [LICENSE](LICENSE).
