"""Generate real Office files for the API runtime's artifact acceptance test.

Requires the machine's python-pptx, python-docx and openpyxl packages. The
runtime writes this script with write_file and executes it with run_command;
the acceptance verifier uses zipfile/ElementTree rather than these libraries.
"""

import argparse
import json
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from pptx import Presentation


def generate(folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    title = "Carb workflow acceptance"
    values = [12, 18, 12]

    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[1])
    slide.shapes.title.text = title
    body = slide.placeholders[1].text_frame
    body.text = "Read an installed skill"
    for text in ["Generate real files", "Verify all output formats"]:
        body.add_paragraph().text = text
    result = deck.slides.add_slide(deck.slide_layouts[1])
    result.shapes.title.text = "Verified total: 42"
    result.placeholders[1].text = "12 + 18 + 12 = 42"
    deck.save(folder / "acceptance.pptx")

    document = Document()
    document.add_heading(title, level=0)
    document.add_paragraph("Verified total: 42")
    document.add_paragraph("Installed skill read, workspace tools executed, outputs independently inspected.")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Item"
    table.rows[0].cells[1].text = "Amount"
    for index, value in enumerate(values, start=1):
        row = table.add_row().cells
        row[0].text = f"Item {index}"
        row[1].text = str(value)
    document.save(folder / "acceptance.docx")

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Acceptance"
    sheet.append(["Item", "Amount"])
    for index, value in enumerate(values, start=1):
        sheet.append([f"Item {index}", value])
    sheet.append(["Total", "=SUM(B2:B4)"])
    sheet.column_dimensions["A"].width = 20
    sheet.column_dimensions["B"].width = 16
    workbook.save(folder / "acceptance.xlsx")
    return [str(folder / f"acceptance.{kind}") for kind in ["pptx", "docx", "xlsx"]]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    arguments = parser.parse_args()
    print(json.dumps({"created": generate(arguments.folder)}, ensure_ascii=False))
