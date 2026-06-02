import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def extract_docx_text(docx_path: str | Path) -> str:
    """Extracts text and tables from a .docx file and formats them in Markdown-like structure."""
    path = Path(docx_path)
    if not path.exists():
        return f"Error: File {docx_path} does not exist."

    try:
        with zipfile.ZipFile(path) as docx:
            if 'word/document.xml' not in docx.namelist():
                return "Error: Invalid docx file (missing word/document.xml)."
            
            xml_content = docx.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # Namespace map for Word elements
            ns = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
            }
            
            body = root.find('.//w:body', ns)
            if body is None:
                return ""
            
            output = []
            
            # Process body elements sequentially to keep paragraph/table order
            for child in body:
                tag = child.tag
                local_tag = tag.split('}')[-1] if '}' in tag else tag
                
                if local_tag == 'p':
                    p_text = _parse_paragraph(child, ns)
                    if p_text is not None:
                        output.append(p_text)
                elif local_tag == 'tbl':
                    table_md = _parse_table(child, ns)
                    if table_md:
                        output.append(table_md)
                        
            return "\n\n".join(output)
            
    except Exception as e:
        return f"Error parsing docx file: {e}"

def _parse_paragraph(p_node, ns) -> str | None:
    runs = []
    for elem in p_node.iter():
        elem_tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if elem_tag == 't':
            if elem.text:
                runs.append(elem.text)
        elif elem_tag == 'tab':
            runs.append("\t")
        elif elem_tag == 'br':
            runs.append("\n")
            
    text = "".join(runs).strip()
    if not text:
        return None
        
    # Check if styled as a heading
    style_node = p_node.find('.//w:pStyle', ns)
    if style_node is not None:
        style_val = style_node.attrib.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '')
        if 'Heading' in style_val:
            try:
                level_str = ''.join(filter(str.isdigit, style_val))
                level = int(level_str) if level_str else 1
                level = min(max(level, 1), 6)
                return "#" * level + " " + text
            except Exception:
                return "### " + text
                
    return text

def _parse_table(tbl_node, ns) -> str:
    rows_data = []
    max_cols = 0
    
    for row in tbl_node.findall('.//w:tr', ns):
        row_cells = []
        for cell in row.findall('.//w:tc', ns):
            cell_paragraphs = []
            for p in cell.findall('.//w:p', ns):
                p_txt = _parse_paragraph(p, ns)
                if p_txt:
                    cell_paragraphs.append(p_txt)
            cell_text = " ".join(cell_paragraphs).replace("|", "\\|").replace("\n", " ").strip()
            row_cells.append(cell_text)
        if row_cells:
            rows_data.append(row_cells)
            max_cols = max(max_cols, len(row_cells))
            
    if not rows_data:
        return ""
        
    md_lines = []
    
    # Header row formatting
    header = rows_data[0]
    header += [""] * (max_cols - len(header))
    md_lines.append("| " + " | ".join(header) + " |")
    md_lines.append("| " + " | ".join(["---"] * max_cols) + " |")
    
    # Data rows formatting
    for row in rows_data[1:]:
        row += [""] * (max_cols - len(row))
        md_lines.append("| " + " | ".join(row) + " |")
        
    return "\n".join(md_lines)
