# Insulation Takeoff Operator Guide

Use this guide as the working sequence for taking a plan PDF from upload to finished estimate. It explains what each tool does, when to use it, and how to avoid the common mistakes that make quantities wrong.

This version is text-first on purpose. Do not train from mock screenshots. Add real screenshots only after capturing them from the live app.

## 1. Proper Job Sequence

Follow this order on every project.

1. Confirm company settings before the first quote: company name, logo, quote terms, and tax settings.
2. Create or select the client.
3. Create the project and upload the plan PDF.
4. Open the project and click Open Takeoff.
5. Use Vision to choose which pages matter.
6. Use Areas to define the building areas before detailed measuring.
7. Calibrate every plan page you measure.
8. Use Takeoff to trace walls, surfaces, roof/pitch areas, windows, and doors.
9. Review the worksheet and fix missing or wrong rows.
10. Generate the quote, review pricing and terms, then download the PDF.

Do not skip calibration. A page with the wrong scale will produce wrong wall lengths, square footage, opening deductions, and quote totals.

## 2. What Each Workflow Step Does

### Project

Project is where the job starts. Use it to store the client, plan PDF, supporting documents, and final quote.

- New Project creates the job record.
- Documents stores plans, schedules, specs, photos, and other files.
- Open Takeoff starts the measured workflow from the uploaded plan PDF.

### Vision

Vision scans the plan set and helps you decide which pages belong in the takeoff.

- Primary Takeoff means this page will be measured.
- Support Page means the page is evidence, notes, schedules, sections, or details.
- Ignore means the page is not needed for the estimate.
- AI suggests page roles and extracts visible clues such as dimensions, R-values, insulation notes, roof pitch, vapor/air barrier notes, baffles/venting, window sizes, and opening hints.

Use Vision to catch floor plans, reflected ceiling plans, wall sections, window schedules, door schedules, and insulation notes. If the app misses a useful page, select it manually.

### Areas

Areas divide the building into estimate zones. The area tells the system what the walls, ceilings, floors, and surfaces belong to.

- Living / Heated Area is used for normal conditioned space.
- Garage / Shared Wall is used where garage walls or ceilings touch conditioned space.
- Attic / Ceiling Insulation is used for ceiling or attic scope.
- Crawlspace / Floor Insulation is used for floor insulation over crawlspace or unconditioned space.
- Storage / Manual Review is used when the plan needs a manual note or special handling.
- AI can suggest likely takeoff areas, useful pages, and scan-backed clues. The user still traces and confirms the final area.

### Takeoff

Takeoff is where quantities are created. This step uses the calibration and the selected area to turn traced lines and shapes into estimate rows.

- Wall tools create wall length and wall square footage.
- Surface tools create attic floors, crawlspace floors, garage ceilings, sound floors, cathedral ceilings, cantilever floors, and similar surfaces.
- Window and Door tools place openings on walls so deductions are tied to the correct wall.
- Roof tools handle pitch-adjusted or vaulted ceiling sections.
- AI can read selected window notes, door notes, and roof pitch boxes when you use Win scan, Door scan, or Scan pitch. The user saves or overrides the result.

### Review Takeoff

Review Takeoff is the worksheet check before pricing. Use it to confirm the measured rows, quantities, specs, and deductions before the quote is created.

The worksheet is seeded from the measured takeoff and scan-backed clues, but the estimator must verify every row before quoting.

### Quote

Quote is where the estimate becomes the customer-facing PDF. Use it to confirm quantities, unit prices, included rows, manual additions, tax, and terms.

AI does not approve the quote. The user is responsible for final included rows, pricing, terms, tax, and the downloaded PDF.

## 3. What AI Does

AI is an assistant, not the estimator. Treat every AI result as a suggestion that must be confirmed.

### Vision AI

- Reads plan pages during the Vision step.
- Suggests whether a page is Primary Takeoff, Support Page, or not useful.
- Flags pages with dimensions, floor plan geometry, support details, schedules, insulation notes, roof/ceiling details, floor/foundation details, opening information, material specs, and keynotes.
- Extracts visible clues such as R-values, insulation types, roof pitches, vapor barrier notes, air barrier notes, baffles/venting, window sizes, and opening notes.
- User confirms which pages stay in the takeoff.

### Area AI

- Uses scanned page context to suggest likely areas such as living/heated area, garage/shared wall, attic/ceiling, or crawlspace/floor.
- Suggests the best page to start from when multiple pages are available.
- May carry visible scan clues into area fields, such as insulation type, R-value, or pitch.
- User still calibrates the page, traces the area, names the area, and confirms the final settings.

### Measuring AI

- Win scan reads a selected window note or window area and suggests width and height.
- Door scan reads a selected door note or door area and suggests width, height, and sometimes door type.
- Scan pitch reads a selected roof pitch note and suggests rise/run.
- User saves the result only if it is correct. If it is wrong, type the value manually.

### Review AI

- The app uses measured traces, openings, areas, and scan-backed clues to seed worksheet rows.
- User verifies description, quantity, unit, spec, R-value, deductions, and manual rows before creating the quote.

### AI Limits

- AI does not calibrate the plan page for you.
- AI does not know whether a bad drawing dimension is trustworthy.
- AI does not approve pricing, tax, terms, or final quote scope.
- If AI output conflicts with the plan, schedule, or estimator judgment, use the plan and correct it manually.

## 4. Tool List

These are the main tools users see while measuring.

### Select

Select is the normal pointer tool.

- Use it to click an existing trace, wall segment, surface, window, or door.
- Use Delete selection to remove the selected item.
- Use it before editing an existing item.

### Cal. or Scale

Cal. and Scale start page calibration.

- Use this before tracing areas, walls, surfaces, windows, or doors.
- Calibration is page-specific. If you switch to another plan page, calibrate that page too.
- Use a long known dimension when possible. Longer dimensions reduce scale error.

### Area

Area traces a polygon around a building zone.

- Use it in the Areas step to define the scope zones.
- Click around the outside boundary of the area.
- Close the shape by clicking near the first point, double-clicking, or pressing Enter.
- Fill in the area settings after the shape is complete.

### 6 Inch Wall

6 inch wall traces exterior or 2x6 wall assemblies.

- Use it for exterior walls or any wall scope that should price as 2x6.
- Trace along the wall centerline or the most consistent wall line on the plan.
- Use Fill left/right when the wall assembly needs to face the other side.

### 4 Inch Wall

4 inch wall traces interior, 2x4, garage shared, basement, knee wall, or similar wall scope when appropriate.

- Use it for wall types that are not 2x6 exterior scope.
- Confirm the wall preset/spec before tracing if the tool panel exposes a specific preset.

### Surface

Surface traces area-based insulation that is not a wall.

- Attic Floor is used for flat attic insulation.
- Crawlspace Floor is used for floor insulation over crawlspace.
- Garage Ceiling is used where garage ceiling separates conditioned space.
- Sound Floor is used for acoustic floor insulation.
- Cathedral Ceiling is used for sloped or vaulted ceiling scope.
- Cantilever Floor is used for floor over exterior air.

### Roof

Roof handles roof or ceiling pitch work.

- Trace roof or vaulted ceiling areas that need pitch-adjusted quantity.
- Scan pitch or enter rise/run when the plan shows pitch.
- Apply pitch after confirming the value.
- Clear pitch if the wrong pitch was applied.

### Win Scan

Win scan detects or places window openings.

- Select or trace the related wall layer first.
- Scan when the plan has readable window notes or dimensions.
- Type width and height manually when scan output is wrong.
- Save the opening, then Complete when the window placement is done.

### Door Scan

Door scan detects or places door openings.

- Select or trace the related wall layer first.
- Choose the door type: Door, French Door, Garage Door, Sliding Door, or Door Opening.
- Scan when the plan has readable door notes or schedules.
- Type width and height manually when scan output is wrong.
- Save the opening, then Complete when done.

## 5. How To Calibrate

Calibration tells the app how many PDF points equal one real foot. Every measurement depends on this.

### Choose the right dimension

- Pick a printed dimension that is easy to verify.
- Use the longest clean dimension on the page when possible.
- Prefer an overall building dimension over a short room dimension.
- Do not calibrate from a dimension that is blurry, cut off, curved, or part of a detail at a different scale.

### Calibration sequence

1. Open the plan page you are going to measure.
2. Click Cal. in Areas or Scale in Takeoff.
3. Move to the first endpoint of the known dimension.
4. Click the first endpoint.
5. Move to the second endpoint.
6. Click the second endpoint.
7. Enter the real printed length.
8. Press Enter or confirm the input.
9. Confirm the page shows Scale on or allows tracing.

Accepted length examples include `24`, `24 ft`, `24'-0"`, `24'-6"`, and similar feet/inch formats.

### Snap behavior

- The app tries to snap calibration points to nearby vector endpoints.
- The snap preview helps place the point exactly on a plan line.
- Hold Alt while clicking if the snap point is wrong and you need to place the point manually.

### When to recalibrate

Recalibrate when a wall length looks obviously wrong, when the plan page changed, when you measured from a bad printed dimension, or when a scanned plan has separate details at different scales.

### Calibration quality check

After calibration, trace or compare one known wall dimension. If it is off, recalibrate using a longer dimension. Do not continue the takeoff until the scale is believable.

## 6. Vision Step Details

Vision is not the estimate. It is page selection.

1. Review the page thumbnails and labels.
2. Read the AI suggested role and Vision Summary.
3. Mark floor plans as Primary Takeoff.
4. Mark schedules, wall sections, details, and notes as Support Page.
5. Ignore cover sheets, marketing pages, and pages that do not affect insulation scope.
6. Continue only after all measurement pages are selected.

Use Support Pages as evidence when checking wall height, R-value, ceiling type, roof pitch, window sizes, door sizes, and special notes.

## 7. Areas Step Details

Areas should be completed before detailed takeoff. A wall or surface needs to belong to the correct area so the worksheet is organized correctly.

### Area sequence

1. Select a suggested area or click Area.
2. Calibrate the page if Scale is off.
3. Click around the area boundary.
4. Close the shape by clicking near the starting point, double-clicking, or pressing Enter.
5. Set the area label and zone type.
6. Fill in floor/level, ceiling type, ceiling height, roof pitch, insulation type, and R-value when the app asks for them.
7. Check Area Catalog to confirm the area was saved.

### Area tips

- Use one area for each estimate zone that needs different pricing, R-value, ceiling type, floor type, or wall condition.
- Separate garage shared walls from normal living-area exterior walls.
- Separate attic/ceiling scope from wall scope when the ceiling insulation type or R-value is different.
- If the plan has multiple floors, label the area by floor.

## 8. Takeoff Step Details

Takeoff is where you trace the measured scope.

### Before tracing

1. Select the correct area from the Areas list.
2. Confirm the page is calibrated.
3. Pick the correct tool: 6 inch wall, 4 inch wall, Surface, Roof, Win scan, or Door scan.
4. Confirm the active wall/surface preset and R-value when available.

### Wall tracing sequence

1. Choose 6 inch wall or 4 inch wall.
2. Click the first wall point.
3. Continue clicking each wall corner or endpoint.
4. Use the snap preview when the plan has vector linework.
5. Hold Alt if snapping lands on the wrong point.
6. Press Enter or double-click to finish a run.
7. Use Tab to flip wall fill side when the wall is facing the wrong direction.
8. Use Undo point if the last point is wrong.
9. Use Continue wall to keep drawing from an existing wall.
10. Use Delete selection only after selecting the wrong wall or segment.

### Keyboard shortcuts while tracing

- Enter finishes the active trace when enough points exist.
- Double-click also finishes a trace.
- Backspace or Delete removes the last active point while tracing.
- Backspace or Delete removes a selected trace or segment when using Select.
- Escape cancels the active tool, calibration, or selection.
- ArrowLeft and ArrowRight switch between selected pages when you are not typing in an input.
- Tab flips the wall fill side during wall tracing.

### Surface sequence

1. Select the correct area.
2. Choose the surface preset, such as Attic Floor, Crawlspace Floor, Garage Ceiling, Sound Floor, Cathedral Ceiling, or Cantilever Floor.
3. Click Trace.
4. Trace the surface boundary.
5. Click Apply when the surface is correct.
6. Delete selection if the wrong surface was created.

### Roof sequence

1. Select Roof.
2. Trace the vaulted, roof, or pitch-adjusted ceiling area.
3. Click Use selection if applying pitch to an existing traced shape.
4. Click Scan pitch or type rise/run manually.
5. Click Apply pitch.
6. Use Clear pitch if the pitch is wrong.

### Window sequence

1. Select the wall that the window belongs to.
2. Click Win scan.
3. Scan the window note or type width and height manually.
4. Place the window on the correct wall.
5. Click Save.
6. Repeat for each window.
7. Click Complete when finished.

### Door sequence

1. Select the wall that the door belongs to.
2. Click Door scan.
3. Choose the door type.
4. Scan the door note or type width and height manually.
5. Place the door on the correct wall.
6. Click Save.
7. Repeat for each door.
8. Click Complete when finished.

Windows and doors should be attached to the correct wall so the worksheet deducts opening square footage from the right wall row.

## 9. Review The Worksheet

Review Takeoff is the estimator check.

Check each row before continuing.

- Description: make sure the row describes the correct scope.
- Quantity: verify SF, LF, or EA looks reasonable.
- Unit: confirm wall rows, surface rows, openings, and custom rows use the right unit.
- Spec: confirm R-value, wall type, and surface type.
- Deductions: confirm windows and doors are deducting from the right wall.
- Manual rows: add missing scope that was not practical to trace.

Wait for the worksheet to save before continuing to the quote.

## 10. Prepare The Quote PDF

The quote page turns the worksheet into the customer document.

1. Review every estimate row.
2. Confirm quantities and unit prices.
3. Turn off rows that should not be included.
4. Add manual line items for special labor, mobilization, minimums, or one-off scope.
5. Confirm tax settings.
6. Review Terms & Conditions.
7. Click Generate Quote.
8. Download the PDF.
9. If you change a row after generating, click Regenerate Quote.

## 11. Final QA Checklist

Run this checklist before sending the quote.

- Client and project name are correct.
- All measured pages were selected in Vision.
- AI suggestions were reviewed and corrected where needed.
- Every measured page is calibrated.
- Known dimensions still look correct after calibration.
- Areas are traced and named clearly.
- Wall height, ceiling type, insulation type, and R-value are filled in.
- 6 inch and 4 inch wall scope is separated correctly.
- Garage shared wall and garage ceiling scope are separated from normal living area scope.
- Attic, crawlspace, sound floor, cathedral ceiling, and cantilever scope use the correct surface preset.
- Windows and doors are attached to the correct walls.
- Opening deductions look reasonable.
- Manual rows are intentional and clearly described.
- Unit prices, tax, and terms are correct.
- Quote PDF downloads and opens correctly.

## 12. Common Fixes

Measurements look wrong:

- Recalibrate the page using a longer known dimension.
- Make sure you calibrated the same page you are measuring.
- Check whether the plan page contains multiple detail scales.

A wall is on the wrong side:

- Select the wall and flip the fill side, or use Tab while tracing.

The app snapped to the wrong point:

- Hold Alt while placing the point.

The area will not trace:

- Calibrate the page first.
- Make sure you are in the Areas step and Area tool is active.

A window or door scan is wrong:

- Type the width and height manually.
- Check the schedule or support page before saving.

An item is missing from the quote:

- Add it as a manual row in Review Takeoff or the quote page.

Need help:

- Use New ticket in the sidebar and include a screenshot of the page and the issue.
