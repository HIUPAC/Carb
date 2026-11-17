"""Independently inspect acceptance outputs with only Python's standard library."""

import argparse
import hashlib
import json
import posixpath
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
MAIN = {
    "pptx": ("ppt/presentation.xml", "p:presentation"),
    "docx": ("word/document.xml", "w:document"),
    "xlsx": ("xl/workbook.xml", "s:workbook"),
}


def qualified(short: str) -> str:
    prefix, local = short.split(":")
    return "{" + NS[prefix] + "}" + local


def office(filename: Path) -> dict:
    main, main_root = MAIN[filename.suffix[1:]]
    with ZipFile(filename) as package:
        assert package.testzip() is None, "ZIP CRC failure"
        names = set(package.namelist())
        roots = {
            name: ET.fromstring(package.read(name))
            for name in names
            if name.endswith((".xml", ".rels"))
        }
        assert roots[main].tag == qualified(main_root), "Wrong document XML root"
        types = roots["[Content_Types].xml"]
        assert types.tag == qualified("ct:Types")
        assert any(item.attrib.get("PartName") == "/" + main for item in types), "Main content type missing"
        package_rels = roots["_rels/.rels"]
        assert package_rels.tag == qualified("r:Relationships")
        assert any(
            item.attrib.get("Type", "").endswith("/officeDocument")
            and item.attrib["Target"].lstrip("/") == main
            for item in package_rels
        ), "Office root relationship missing"
        relationships = 0
        for name, tree in roots.items():
            if not name.endswith(".rels"):
                continue
            base = "" if name == "_rels/.rels" else name.rsplit("/_rels/", 1)[0]
            for relation in tree:
                if relation.attrib.get("TargetMode") == "External":
                    continue
                target = relation.attrib["Target"]
                resolved = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(base, target))
                assert not resolved.startswith("../") and resolved in names, f"Broken relationship: {name} -> {resolved}"
                relationships += 1

        kind = filename.suffix[1:]
        if kind == "pptx":
            slides = [tree for name, tree in roots.items() if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
            assert len(slides) == 2
            text = " ".join(node.text or "" for slide in slides for node in slide.findall(".//a:t", NS))
            assert "Carb workflow acceptance" in text and "Verified total: 42" in text
        elif kind == "docx":
            text = " ".join(node.text or "" for node in roots[main].findall(".//w:t", NS))
            assert "Carb workflow acceptance" in text and "Verified total: 42" in text
            assert roots[main].find(".//w:tbl", NS) is not None
        else:
            sheet = roots["xl/worksheets/sheet1.xml"]
            cells = {cell.attrib["r"]: cell for cell in sheet.findall(".//s:c", NS)}
            values = [int(cells[f"B{row}"].findtext("s:v", namespaces=NS)) for row in range(2, 5)]
            assert values == [12, 18, 12] and sum(values) == 42
            assert cells["B5"].findtext("s:f", namespaces=NS) == "SUM(B2:B4)"
        return {"kind": kind, "entries": len(names), "xml_parts": len(roots), "internal_relationships": relationships, "content_verified": True}


def inspect(folder: Path) -> dict:
    records = []
    for kind in ["pptx", "docx", "xlsx"]:
        filename = folder / f"acceptance.{kind}"
        record = office(filename)
        record.update(path=str(filename.resolve()), bytes=filename.stat().st_size, sha256=hashlib.sha256(filename.read_bytes()).hexdigest())
        records.append(record)

    program = folder / "acceptance.py"
    code = program.read_text(encoding="utf-8")
    compile(code, str(program), "exec")
    completed = subprocess.run([sys.executable, str(program)], capture_output=True, text=True, check=True, timeout=10)
    assert json.loads(completed.stdout) == {"items": 3, "total": 42}
    records.append({"kind": "py", "path": str(program.resolve()), "execution_exit_code": completed.returncode, "stdout": completed.stdout.strip(), "sha256": hashlib.sha256(program.read_bytes()).hexdigest()})

    markdown = folder / "acceptance.md"
    content = markdown.read_text(encoding="utf-8")
    assert content.startswith("# Carb workflow acceptance\n")
    assert "Total: **42**" in content and "fixture-five-format" in content
    for kind in ["pptx", "docx", "xlsx", "py"]:
        assert f"(acceptance.{kind})" in content
    records.append({"kind": "md", "path": str(markdown.resolve()), "content_verified": True, "sha256": hashlib.sha256(markdown.read_bytes()).hexdigest()})
    return {"ok": True, "independent": "Python stdlib zipfile, ElementTree, relationship resolution, subprocess execution and text assertions", "records": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(inspect(arguments.folder), ensure_ascii=False, indent=2))
