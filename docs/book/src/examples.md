# examples

Tasks to ask Claude, and the tool calls each one leads to. The profiles are
made up: `Work` in `Default`, and `Personal` in `Profile 3`.

## read a page

> open example.com in my work profile and tell me what it says

```text
list_profiles        Work (Default) connected, Personal (Profile 3) connected
select_profile       profile: "Work"
navigate             url: "example.com"
get_page_text
tabs_close           tabId: the tab it opened
```

## fill a form

> on the contact page of example.com, fill in the form with test values
> but do not send it

```text
list_profiles
select_profile       profile: "Personal"
navigate             url: "example.com/contact"
find                 query: "name field"
read_page            filter: "interactive"
form_input           ref: the name field, value: "Test Person"
form_input           ref: the message field, value: "Hello"
computer             action: "screenshot"
```

`form_input` sets values instantly. Ask for it to be typed like a person and
Claude uses `computer` with `action: "type"` instead.

## do a few steps in one go

> search example.com for "tea" and take a screenshot of the results

```text
navigate             url: "example.com"
browser_batch        computer left_click on the search box,
                     computer type "tea",
                     computer key "Enter",
                     computer screenshot
```

## read what went wrong

> the checkout page on example.com shows an error, find out why

```text
navigate                url: "example.com/checkout"
read_console_messages   pattern: "error|warn"
read_network_requests   urlPattern: "/api/"
```

## upload a file

> attach report.pdf from my Downloads folder to the upload form

```text
find                 query: "file input"
file_upload          ref: the file input, paths: ["/path/to/report.pdf"]
```

Claude never clicks a file input: it opens a picker it cannot see.

## make a gif

> show me how to reach the pricing page, as a gif

```text
gif_creator          action: "start_recording"
navigate, computer   the clicks
gif_creator          action: "stop_recording"
gif_creator          action: "export", filename: "pricing.gif"
```

## repeat what you recorded

> do what i just recorded, but search for "coffee"

```text
recording_list
recording_get        newest, as text
recording_replay     values: {"3": "coffee"}
```

More on each: [recording and replay](guides/recording.md). Every input is on
the [tools](reference/tools.md) page.
