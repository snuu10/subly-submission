import AppKit
import CoreGraphics
import CoreText
import Foundation

private struct RGBA {
  let red: CGFloat
  let green: CGFloat
  let blue: CGFloat
  let alpha: CGFloat

  init(hex: UInt32, alpha: CGFloat = 1) {
    red = CGFloat((hex >> 16) & 0xff) / 255
    green = CGFloat((hex >> 8) & 0xff) / 255
    blue = CGFloat(hex & 0xff) / 255
    self.alpha = alpha
  }

  var cgColor: CGColor { CGColor(red: red, green: green, blue: blue, alpha: alpha) }
}

private let indigo = RGBA(hex: 0x4F46E5)
private let ink = RGBA(hex: 0x111827)
private let lavender = RGBA(hex: 0xEEF2FF)
private let white = RGBA(hex: 0xFFFFFF)

private func bitmapContext(width: Int, height: Int) -> CGContext {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  return CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )!
}

private func drawSymbol(
  _ source: CGImage,
  in context: CGContext,
  rect: CGRect,
  color: RGBA
) {
  let layer = bitmapContext(width: context.width, height: context.height)
  layer.clear(CGRect(x: 0, y: 0, width: context.width, height: context.height))
  layer.draw(source, in: rect)
  layer.setBlendMode(.sourceIn)
  layer.setFillColor(color.cgColor)
  layer.fill(rect)

  if let image = layer.makeImage() {
    context.draw(image, in: CGRect(x: 0, y: 0, width: context.width, height: context.height))
  }
}

private func writePNG(_ image: CGImage, to url: URL) throws {
  let representation = NSBitmapImageRep(cgImage: image)
  guard let data = representation.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "SublyBrandAssets", code: 1)
  }
  try data.write(to: url)
}

private func makeSquare(
  source: CGImage,
  size: Int,
  background: RGBA?,
  symbolColor: RGBA,
  symbolScale: CGFloat = 1
) -> CGImage {
  let context = bitmapContext(width: size, height: size)
  let canvas = CGRect(x: 0, y: 0, width: size, height: size)

  if let background {
    context.setFillColor(background.cgColor)
    context.fill(canvas)
  } else {
    context.clear(canvas)
  }

  let inset = CGFloat(size) * (1 - symbolScale) / 2
  drawSymbol(source, in: context, rect: canvas.insetBy(dx: inset, dy: inset), color: symbolColor)
  return context.makeImage()!
}

private func makeHorizontalLogo(source: CGImage, fontURL: URL) -> CGImage {
  let width = 1600
  let height = 512
  let context = bitmapContext(width: width, height: height)
  context.clear(CGRect(x: 0, y: 0, width: width, height: height))

  drawSymbol(
    source,
    in: context,
    rect: CGRect(x: 48, y: 48, width: 416, height: 416),
    color: indigo
  )

  CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, nil)
  let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL as CFURL) as? [CTFontDescriptor]
  let descriptor = descriptors?.first ?? CTFontDescriptorCreateWithNameAndSize("Helvetica-Bold" as CFString, 0)
  let font = CTFontCreateWithFontDescriptor(descriptor, 228, nil)
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink.cgColor,
    .kern: -7,
  ]
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: "subly", attributes: attributes))
  context.textPosition = CGPoint(x: 490, y: 145)
  CTLineDraw(line, context)

  return context.makeImage()!
}

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: generate-brand-assets.swift <source-symbol.png> <output-directory>\n", stderr)
  exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let fontURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
  .appendingPathComponent("assets/fonts/Pretendard-Bold.otf")

guard
  let imageSource = NSImage(contentsOf: sourceURL),
  let source = imageSource.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  fputs("Could not load source symbol.\n", stderr)
  exit(1)
}

try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let outputs: [(String, CGImage)] = [
  ("brand-mark.png", makeSquare(source: source, size: 1024, background: nil, symbolColor: indigo)),
  ("icon.png", makeSquare(source: source, size: 1024, background: lavender, symbolColor: indigo)),
  ("android-icon-foreground.png", makeSquare(source: source, size: 1024, background: nil, symbolColor: white, symbolScale: 0.82)),
  ("android-icon-monochrome.png", makeSquare(source: source, size: 432, background: nil, symbolColor: white, symbolScale: 0.82)),
  ("splash-icon.png", makeSquare(source: source, size: 1024, background: nil, symbolColor: indigo, symbolScale: 0.82)),
  ("favicon.png", makeSquare(source: source, size: 48, background: indigo, symbolColor: white, symbolScale: 0.88)),
  ("logo-horizontal.png", makeHorizontalLogo(source: source, fontURL: fontURL)),
]

for (filename, image) in outputs {
  try writePNG(image, to: outputURL.appendingPathComponent(filename))
  print("Wrote \(filename)")
}
