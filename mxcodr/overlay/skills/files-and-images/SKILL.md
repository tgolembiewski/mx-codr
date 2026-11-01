---
name: files-and-images
description: "Photos, images and documents that users upload, show, download or delete in a Mendix app: the System.Image and System.FileDocument entities, the Marketplace File Uploader, thumbnails and large photos, document lists with name and size, download and delete, and a PDF the app generates (invoice, receipt, report). Use before building any upload, photo, picture, attachment, document or file feature, and when an image or a file upload does not build or does not show."
---

# Files and images

A Mendix 11 app (React client) uploads, shows and downloads files with a few
fixed parts. Each one below was built, checked with `mx check` and used in the
browser (file-image session, 2026-10-13). Take these; do not search the mxcli
binary or the widget packages for other spellings -- that cost a session a
quarter of an hour.

## 1. The entities

A photo is a specialisation of `System.Image`, a document of `System.FileDocument`,
each owned by the object it belongs to:

```sql
create or modify persistent entity Catalogue.ProductPhoto extends System.Image (
);
create or modify persistent entity Catalogue.ProductDocument extends System.FileDocument (
);
create or modify association Catalogue.Product_Photos
  from Catalogue.ProductPhoto to Catalogue.Product
  type Reference owner Default on delete cascade;
create or modify association Catalogue.Product_Documents
  from Catalogue.ProductDocument to Catalogue.Product
  type Reference owner Default on delete cascade;
```

`Name`, `Size` and `Contents` come from `System.FileDocument`; give the role
`read`/`write` on them like on any attribute (no `write *` on the specialisation:
CE6592).

## 2. Uploading: the Marketplace File Uploader

**A new app does not have the File Uploader. Install it yourself, now** -- headless, about a
minute, before the first upload page (`imageuploader`, `fileuploader` and `filemanager` are
refused until it is there):

```bash
./mxcli run stop -p App.mpr && ./mxcli marketplace install 235351 -p App.mpr && ./mxcli fix widgets -p App.mpr
./mxcli run --local --watch --detach -p App.mpr      # boot again before the next test run
```

235351 is the File Uploader (publisher Mendix). The install repairs what a headless install leaves
(CE0463) itself. It needs mxcli logged in (`./mxcli auth status`). When it is not, the install
stops with the login message -- ask the person to run `./mxcli auth login` and wait; when nobody
can answer (an unattended run), report the upload as not built, with that reason.

"Not installed" is never a reason to leave out or defer an upload the request names: install it.
Only when the install itself fails: the built-in `filemanager` in a data view over the image or
file (`filemanager Customer_LogoManager (Type: Upload, ...)`), with the install's error quoted in
the final report.

The test of that feature uploads a file through the uploader (Playwright's `setInputFiles` on its
file input, a 1x1 PNG is enough) and asserts the row it made, by its name, in the list or the data.

After an exec that writes a `fileuploader`, run `./mxcli fix widgets -p App.mpr`; without it the
build fails with CE0463.

The widget sits in a data view over the owner. It creates each file through a
nanoflow, then commits it on success and deletes it on failure:

```sql
dataview ProductDetail_DocumentsForm (DataSource: $Product) {
  fileuploader ProductDetail_DocumentsUploader (
    uploadMode: 'files',                         -- 'images' + associatedImages + createImageAction for photos
    associatedFiles: $currentObject/Catalogue.Product_Documents,
    createFileAction: nanoflow Catalogue.NF_ProductDocument_Create,
    onUploadSuccessFile: nanoflow Catalogue.NF_ProductDocument_Uploaded,
    onUploadFailureFile: nanoflow Catalogue.NF_ProductDocument_Failed,
    maxFileSize: 25
  ) {
    allowedfileformat pdf (configMode: 'simple', predefinedType: 'pdfFile')
    allowedfileformat word (configMode: 'simple', predefinedType: 'msWordFile')
  }
}
```

```sql
create or modify nanoflow Catalogue.NF_ProductDocument_Create ($Product: Catalogue.Product)
begin
  @caption 'Start the document'
  $Document = create Catalogue.ProductDocument (Product_Documents = $Product) refresh;
  @caption 'Store the document'
  commit $Document refresh;
end;
```

The create nanoflow must create the object: one that returns without creating it
leaves the widget stuck ("did not create any objects within 10 seconds").

## 3. Showing a photo

**Thumbnail and large photo.** Since mxcli 0.27 the Image widget binds to the photo object
in context: put it in a data view, list view or gallery over the `System.Image` specialisation
(or over a `$currentObject` path to it) and size it with `WidthUnit: pixels, Width: 64` for a
list, `320` for a page. Outside a data container, or over an entity that does not extend
`System.Image`, `check` refuses it. The legacy `dynamicimage` is refused in a React-client app (CE0582).

```sql
-- inside the page's data view over the product
listview ProductDetail_PhotosList (DataSource: $currentObject/Catalogue.Product_Photos) {
  image ProductDetail_PhotoImage (Image: $currentObject, WidthUnit: pixels, Width: 64)
}
```

Measured on mxcli 0.27.0 and Mendix 11.12.1: `exec` writes it and `mx check` reports 0 errors. If the
page still shows "No image selected." for a photo that is there, a mxcli older than 0.27 wrote it:
`./mxcli --version`, and the installer's pinned mxcli.

**`ImageType` takes `image`, `imageUrl` or `icon` only.** Another value, such as
`dynamicImage`, is stored without a warning and shows nothing.

## 4. A list of documents: name, size, download, delete

```sql
datagrid ProductDetail_DocumentsGrid (DataSource: $currentObject/Catalogue.Product_Documents) {
  column (Attribute: Name, Caption: 'Name') { textfilter ProductDetail_DocumentNameFilter }
  column (Caption: 'Size', ShowContentAs: dynamicText, DynamicText: '{1}',
          DynamicTextParams: ({1} = toString(ceil($currentObject/Size div 1024)) + ' KB'))
  column (Caption: 'Actions', ShowContentAs: customContent) {
    actionbutton ProductDetail_DocumentDownloadButton (Caption: 'Download',
      Action: call microflow Catalogue.ACT_ProductDocument_Download(Document = $currentObject),
      Icon: 'Atlas_Core.Atlas_Filled.cloud-download')
    actionbutton ProductDetail_DocumentDeleteButton (Caption: 'Delete',
      Action: call microflow Catalogue.ACT_ProductDocument_Delete(Document = $currentObject, Product = $Product),
      Icon: 'Atlas_Core.Atlas_Filled.trash-can')
  }
}
```

MDL divides with `div`, not `/`.

```sql
create or modify microflow Catalogue.ACT_ProductDocument_Download ($Document: Catalogue.ProductDocument)
begin
  @caption 'Offer the document for download'
  download file $Document;
end;

create or modify microflow Catalogue.ACT_ProductDocument_Delete ($Document: Catalogue.ProductDocument, $Product: Catalogue.Product)
begin
  @caption 'Remove the document'
  delete $Document;
  @caption 'Show the product again, with its documents up to date'
  show page Catalogue.Product_Detail (Product = $Product);
end;
```

## 5. Traps

- **Strict mode turns the File Uploader's own Remove off.** It calls
  `mx.data.remove`, which Production security disables. Delete from the grid's row
  button instead, as above.
- **A microflow that deletes leaves the row on screen.** MDL has no
  refresh-in-client for `delete`; re-open the page, as `ACT_ProductDocument_Delete`
  does.
- **Uploading on a create form commits the owner.** Committing the new photo
  commits the new product with it, empty name included. Put the uploader on the
  owner's page after it is saved, or accept that the upload saves it.
- **In a browser test, wait for a grid cell's text, not for its row.** The row
  exists before its cells are filled.

## 6. A document the app generates (PDF)

A document a person reads -- an invoice, a receipt, a report -- is a laid-out
page: each column placed at its own x position, a bold header row with a rule
under it, amounts and totals right-aligned. Lines padded with spaces in a
monospace font (Courier) are not that, nor is one text block with line breaks.

The cheapest verified way here: a Java action that writes the PDF itself, one
`BT ... Tj ET` per cell, with the standard Type1 fonts `Helvetica` and
`Helvetica-Bold` (nothing to embed, no library), and stores the bytes in a
`System.FileDocument` specialisation. Compiled and opened in a viewer:

```java
// BEGIN EXTRA CODE: the content stream and two helpers
private final StringBuilder cs = new StringBuilder();
// F1 = Helvetica, F2 = Helvetica-Bold, named in the page's /Resources /Font
void text(boolean bold, double size, double x, double y, String t) {
  t = t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)");
  cs.append("BT /").append(bold ? "F2" : "F1").append(' ').append(size).append(" Tf ")
    .append(x).append(' ').append(y).append(" Td (").append(t).append(") Tj ET\n");
}
void right(boolean bold, double size, double xr, double y, String t) {  // right edge at xr
  double w = 0;                                    // Helvetica: digits 0.556 em, '.' ' ' 0.278
  for (char c : t.toCharArray()) w += Character.isDigit(c) ? 0.556 : c == '.' || c == ' ' ? 0.278 : 0.6;
  text(bold, size, xr - w * size, y, t);
}
// BEGIN USER CODE: header, rule, rows, total
text(true, 10, 40, 700, "Item"); right(true, 10, 300, 700, "Qty"); right(true, 10, 400, 700, "Price");
cs.append("0.6 w 40 696 m 400 696 l S\n");
text(false, 10, 40, 684, "Coffee"); right(false, 10, 300, 684, "2"); right(false, 10, 400, 684, "6.40");
text(true, 10, 40, 664, "Total"); right(true, 10, 400, 664, "6.40");
// font objects: << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> and /Helvetica-Bold;
// then catalog, pages, page (/MediaBox [0 0 595 842]), the stream, xref; bytes in ISO-8859-1;
Core.storeFileDocumentContent(getContext(), document, "receipt.pdf", new java.io.ByteArrayInputStream(bytes));
```

Start a new page when `y` falls below the bottom margin. A document template
that already exists in the app is the other way; mxcli does not write one, and
Mendix's Document Generation module (it needs its cloud service) only if the
app already has it -- neither is verified here.
