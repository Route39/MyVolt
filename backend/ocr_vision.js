ObjC.import("Foundation");
ObjC.import("AppKit");
ObjC.import("Vision");
ObjC.import("PDFKit");

function extractTokensFromHandler(handler, w, h) {
  var req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0; // .accurate
  req.usesLanguageCorrection = false;
  var err = Ref();
  handler.performRequestsError($([req]), err);
  var results = req.results;
  var tokens = [];
  if (!results) return tokens;
  for (var i = 0; i < results.count; i++) {
    var obs = results.objectAtIndex(i);
    var candList = obs.topCandidates(1);
    if (!candList || candList.count === 0) continue;
    var cand = candList.objectAtIndex(0);
    var s = ObjC.unwrap(cand.string);
    var re = /\S+/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var rErr = Ref();
      var rBox = cand.boundingBoxForRangeError({ location: m.index, length: m[0].length }, rErr);
      var b = rBox ? rBox.boundingBox : obs.boundingBox;
      tokens.push({
        x: Math.round(b.origin.x * w * 10) / 10,
        y: Math.round(b.origin.y * h * 10) / 10,
        w: Math.round(b.size.width * w * 10) / 10,
        h: Math.round(b.size.height * h * 10) / 10,
        text: m[0],
      });
    }
  }
  return tokens;
}

function run(argv) {
  var mode = argv[0];
  var path = argv[1];
  var url = $.NSURL.fileURLWithPath(path);

  if (mode === "image") {
    var img = $.NSImage.alloc.initWithContentsOfFile(path);
    if (!img || !img.representations || img.representations.count === 0) {
      return JSON.stringify([]);
    }
    var rep = img.representations.objectAtIndex(0);
    var w = Number(rep.pixelsWide) || Number(img.size.width);
    var h = Number(rep.pixelsHigh) || Number(img.size.height);
    var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
    return JSON.stringify([{ w: w, h: h, tokens: extractTokensFromHandler(handler, w, h) }]);
  }

  if (mode === "pdf") {
    var doc = $.PDFDocument.alloc.initWithURL(url);
    if (!doc) return JSON.stringify([]);
    var pages = [];
    var count = Math.min(Number(doc.pageCount), 20);
    var scale = 2.0;
    for (var p = 0; p < count; p++) {
      var page = doc.pageAtIndex(p);
      var bounds = page.boundsForBox($.kPDFDisplayBoxMediaBox);
      var w = Math.round(Number(bounds.size.width) * scale);
      var h = Math.round(Number(bounds.size.height) * scale);
      var thumb = page.thumbnailOfSizeForBox({ width: w, height: h }, $.kPDFDisplayBoxMediaBox);
      var tiff = thumb.TIFFRepresentation;
      if (!tiff) {
        pages.push({ w: w, h: h, tokens: [] });
        continue;
      }
      var handler = $.VNImageRequestHandler.alloc.initWithDataOptions(tiff, $.NSDictionary.dictionary);
      pages.push({ w: w, h: h, tokens: extractTokensFromHandler(handler, w, h) });
    }
    return JSON.stringify(pages);
  }

  return JSON.stringify([]);
}
