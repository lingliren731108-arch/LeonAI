import zipfile
import xml.etree.ElementTree as ET
import re
from pathlib import Path

def extract_pptx_text(pptx_path: str | Path) -> str:
    """Extracts text contents from a .pptx file slide-by-slide and returns it in Markdown format."""
    path = Path(pptx_path)
    if not path.exists():
        return f"Error: File {pptx_path} does not exist."

    try:
        with zipfile.ZipFile(path) as pptx:
            namelist = pptx.namelist()
            # Slides are typically named ppt/slides/slide1.xml, ppt/slides/slide2.xml, etc.
            slide_files = sorted(
                [f for f in namelist if f.startswith('ppt/slides/slide') and f.endswith('.xml')],
                key=lambda x: int(re.search(r'\d+', x).group()) if re.search(r'\d+', x) else 0
            )
            
            if not slide_files:
                return "This presentation has no slides or is in an unsupported format."
            
            # Namespace mapping for XML parsing
            ns = {
                'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
                'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'
            }
            
            output = []
            for i, slide_file in enumerate(slide_files, 1):
                xml_content = pptx.read(slide_file)
                root = ET.fromstring(xml_content)
                
                slide_text_blocks = []
                # Find all shape elements in the slide
                for sp in root.findall('.//p:sp', ns):
                    txBody = sp.find('.//p:txBody', ns)
                    if txBody is not None:
                        paragraphs = []
                        for p in txBody.findall('.//a:p', ns):
                            p_text = []
                            for r in p.findall('.//a:r', ns):
                                t = r.find('.//a:t', ns)
                                if t is not None and t.text:
                                    p_text.append(t.text)
                            
                            text_str = "".join(p_text).strip()
                            if text_str:
                                paragraphs.append(text_str)
                        
                        if paragraphs:
                            slide_text_blocks.append("\n".join(f"- {p}" for p in paragraphs))
                
                slide_content = "\n".join(slide_text_blocks) if slide_text_blocks else "*No text content on this slide*"
                output.append(f"## Slide {i}\n\n{slide_content}")
                
            return "\n\n---\n\n".join(output)
            
    except Exception as e:
        return f"Error parsing pptx file: {e}"
