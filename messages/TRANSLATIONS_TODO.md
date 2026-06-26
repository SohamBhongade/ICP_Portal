# Translation review (hi / mr)

The Hindi (`hi.json`) and Marathi (`mr.json`) strings are **best-effort** and
should be reviewed by a native speaker. Replace any that read awkwardly.

Per project guardrail, these are best-effort (not left in English) so the UI is
usable in all three languages today; mark anything you change as verified.

## Please verify these in particular

| key | English | hi | mr | note |
| --- | --- | --- | --- | --- |
| `login.studentTab` | "I am a student" | "मैं छात्र हूँ" | "मी विद्यार्थी आहे" | natural? |
| `login.staffTab` | "Staff" | "स्टाफ" | "कर्मचारी" | hi keeps English loanword; ok? |
| `login.studentIdLabel` | "Student ID" | "छात्र आईडी" | "विद्यार्थी आयडी" | keep "ID"? |
| `login.errors.invalid` | "Invalid credentials…" | "अमान्य क्रेडेंशियल…" | "अवैध क्रेडेन्शियल्स…" | "credentials" transliterated |
| `common.appName` | "ICP Portal" | "ICP पोर्टल" | "ICP पोर्टल" | keep brand in Latin? |

## How Edit Mode interacts

Admins can also override any string at runtime via the `text_overrides` table
(Edit Mode, Phase 7). Those DB overrides take precedence over these JSON files,
so urgent wording fixes can be done from the UI without a redeploy.
