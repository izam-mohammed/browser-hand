# screenshots and gifs

## screenshots

`computer` with `action: "screenshot"` captures the tab. Its text says the
viewport size and the image scale: click coordinates are in the viewport
frame, so divide image pixels by the scale. `zoom` looks closer at a
region, and `save_to_disk` also writes the image to the GIF folder.

The settings page, under **Capture**:

| Setting | Values |
| --- | --- |
| Screenshot size | `1024x640`, `1280x800` (default) or `1568x980`. Bigger shows more detail and costs more tokens. |
| Screenshot quality | JPEG quality, 30 to 100, default 80. |

To keep every screenshot Claude takes, turn on **Save every screenshot**
(off by default) and, if you like, set a **Screenshot folder**; empty uses
the GIF folder. `save_to_disk` still saves a single one whatever the switch
says.

A screenshot gets an `imageId`, good for 5 minutes. `upload_image` sends
that image to a file input or a drop target.

## gifs

For multi-step work you want to review or share, Claude calls
`gif_creator`:

1. `start_recording` takes a first frame, and a frame follows every action.
2. `stop_recording` keeps the frames.
3. `export` writes the GIF, with click circles, drag arrows, action labels
   and a progress bar, and returns the path.
4. `clear` drops the frames.

GIFs and saved screenshots land in the **GIF folder**, by default
`~/Downloads/browser-hand`. **GIF frame delay** (100 to 5000 ms, default
700) sets the playback speed. `BROWSER_HAND_OUTPUT_DIR` overrides the folder
for one server.
