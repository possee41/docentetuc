// Existing public Junta roots. The legacy collector remains unchanged until cutover.
export const JUNTA_EXTERNAL_SOURCES = [
  ["com-primaria", "Comunicados", "Inicial y Primaria", "https://docs.google.com/document/d/1Oo-LmX9DyPBfhZNHPRYYiRf6MJiN837VoSXK2F-LIZE/edit"],
  ["com-secundaria", "Comunicados", "Secundaria", "https://docs.google.com/document/d/1PTKViYaH7i8CHcng99I51lKbZIkjwLnc3ctrJC5898g/edit"],
  ["com-tecnica", "Comunicados", "Técnica, Agrotécnica y No Formal", "https://docs.google.com/document/d/1k0dIv5PJ-CuWabcKhL6mEf-lqfZbGps6V7VdS-ao1F8/edit"],
  ["com-superior", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/1SVQr81QbdgRdfqUAPdBhXBlYxpQwKIdDbqxK35tDoOI/edit"],
  // The public Superior document links these three separate, current notice logs.
  ["com-superior-nivel", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/13NJ0Pd28r_7Xd9plT2lVuYR2AyDcW0Upa3ch7CbvhcQ/edit"],
  ["com-superior-artistica", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/1Ij7ji7zu_k-xZsDky1WaVnA4Lmz3dvDYM3f9WCJF_EA/edit"],
  ["com-superior-especial", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/1pxPt1lwX2gkj4PMkt2j4gtT4S3TxtwBCT7Mvjo5qKEY/edit"],
  ["pad-primaria", "Padrones", "Inicial y Primaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkyZ04zbmxOTFNBNkE?resourcekey=0-N_tuv1wH33HaPvQKhxquww"],
  ["pad-secundaria", "Padrones", "Secundaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkydjZkRTBGV1JzSVE?resourcekey=0-71bD600USZEczBSRONjj-w"],
  ["pad-tecnica", "Padrones", "Técnica, Agrotécnica y No Formal", "https://drive.google.com/drive/folders/0B9nsld8DcxkySC1NUWdSMkdlY2s?resourcekey=0-yI1BMkZQzYW4hFwVMbdvHA"],
  ["pad-superior", "Padrones", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/0B9nsld8DcxkyNzloZnlCbHZhUVE?resourcekey=0-QSoeQ-4hqb9joCnl8FgDrg"],
  ["abiertos-primaria", "Llamados abiertos", "Inicial y Primaria", "https://drive.google.com/drive/folders/1z9S807nunn8JiDl7C8VtBwPlrqb_OESq"],
  ["abiertos-superior", "Llamados abiertos", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/1Cm6ICwm8v2wrmLcjq-yd-U2Bb2MEO6Fx"],
] as const;
