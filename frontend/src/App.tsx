import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { 
  Folder, FolderOpen, File, Send, Bot, User, Play, 
  Download, Terminal, FileCode, CheckCircle, RefreshCw,
  Monitor, Smartphone, Tablet, ChevronRight, ChevronDown, X,
  PanelLeft, MessageSquare, Pin, Paperclip, Square,
  Sparkles, Trash2, Users, LogOut, Plus, Upload, Save, FileText
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import './App.css';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  image?: string; // base64 URL of attached image/screenshot
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  isToolStatus?: boolean;
}

interface UserAccount {
  id: number;
  username: string;
  password?: string;
  role: string;
  created_at?: string;
}

const resolveRelativeSrc = (html: string, htmlFilePath: string, username: string): string => {
  if (!html) return '';
  const parts = htmlFilePath.split('/');
  parts.pop();
  const parentDir = parts.join('/');

  return html.replace(/(src|href)=["']([^"']+)["']/g, (match, attr, src) => {
    if (
      src.startsWith('http://') || 
      src.startsWith('https://') || 
      src.startsWith('data:') || 
      src.startsWith('/') || 
      src.startsWith('#')
    ) {
      return match;
    }

    let resolvedPath = '';
    if (parentDir) {
      const pathParts = parentDir.split('/');
      const srcParts = src.split('/');
      
      for (const part of srcParts) {
        if (part === '.') {
          continue;
        } else if (part === '..') {
          pathParts.pop();
        } else {
          pathParts.push(part);
        }
      }
      resolvedPath = pathParts.join('/');
    } else {
      resolvedPath = src;
    }

    const apiUrl = `/api/workspace/file/raw?path=${encodeURIComponent(resolvedPath)}&user=${encodeURIComponent(username)}`;
    return `${attr}="${apiUrl}"`;
  });
};

interface MarkdownPreviewProps {
  content: string;
  filePath: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = React.memo(({ content, filePath }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const isMd = filePath.endsWith('.md') || filePath.endsWith('.docx') || filePath.endsWith('.pptx');
    if (isMd && content && containerRef.current) {
      const mermaidCodes = containerRef.current.querySelectorAll('pre code.language-mermaid');
      if (mermaidCodes.length > 0) {
        const renderMermaid = (mermaid: any) => {
          mermaidCodes.forEach((codeEl, index) => {
            const preEl = codeEl.parentElement;
            if (!preEl) return;
            
            if (preEl.parentElement?.classList.contains('mermaid-preview-block')) {
              return;
            }

            const rawCode = codeEl.textContent || '';
            
            const wrapperDiv = document.createElement('div');
            wrapperDiv.className = 'mermaid-preview-block';

            const mermaidDiv = document.createElement('div');
            const elementId = `mermaid-diagram-${index}-${Date.now()}`;
            mermaidDiv.id = elementId;
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = rawCode.trim();
            
            wrapperDiv.appendChild(mermaidDiv);
            preEl.replaceWith(wrapperDiv);
            
            mermaid.run({
              querySelector: `#${elementId}`,
              suppressErrors: true
            }).then(() => {
              const svgEl = document.querySelector(`#${elementId} svg`) as HTMLElement;
              if (svgEl) {
                const viewBox = svgEl.getAttribute('viewBox');
                if (viewBox) {
                  const parts = viewBox.split(/[,\s]+/).map(Number);
                  if (parts.length >= 4) {
                    const svgWidth = parts[2];
                    if (svgWidth > 500) {
                      svgEl.style.minWidth = `${Math.min(svgWidth, 1800)}px`;
                    }
                  }
                }
                svgEl.style.width = '100%';
                svgEl.style.height = 'auto';
              }
            }).catch((err: any) => {
              console.error("Mermaid run error:", err);
            });
          });
        };

        const win = window as any;
        if (win.mermaid) {
          renderMermaid(win.mermaid);
        } else {
          const interval = setInterval(() => {
            if (win.mermaid) {
              clearInterval(interval);
              renderMermaid(win.mermaid);
            }
          }, 100);
          return () => clearInterval(interval);
        }
      }
    }
  }, [content, filePath]);

  return (
    <div 
      ref={containerRef} 
      className="markdown-preview markdown" 
      dangerouslySetInnerHTML={{ __html: marked.parse(content) }} 
    />
  );
});

const getLanguageByExtension = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'sh':
    case 'bat':
      return 'shell';
    default:
      return 'plaintext';
  }
};

export default function App() {
  // Authentication State
  const [user, setUser] = useState<{ username: string; role: string } | null>(() => {
    const saved = localStorage.getItem('leon_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });
  
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Tab state: 'design' or 'admin'
  const [activeTab, setActiveTab] = useState<'design' | 'admin'>('design');

  // Admin page users list
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [adminFormUser, setAdminFormUser] = useState({ username: '', password: '', role: 'user' });

  // Main system states
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '你好！我是 **Leon AI** 开发助手。我们可以通过类似 Cursor 的方式进行轻量级应用系统开发！\n\n您可以随时在左侧新建或管理文件树，在中间编辑代码或预览页面。请输入您的开发想法，例如："**帮我开发一个漂亮的个人博客页面**"。'
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  
  // Tabbed File Editor States
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const [editorContents, setEditorContents] = useState<Record<string, string>>({});
  const [unsavedChanges, setUnsavedChanges] = useState<Record<string, boolean>>({});
  const [viewModes, setViewModes] = useState<Record<string, 'code' | 'preview'>>({});
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  
  // Terminal Panel States
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [terminalCommand, setTerminalCommand] = useState<string>('');
  const [terminalOutput, setTerminalOutput] = useState<string>('Leon AI Terminal v1.0.0\nType commands below. Cwd is locked inside your workspace.\n\n');
  const [isTerminalRunning, setIsTerminalRunning] = useState<boolean>(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTool, setCurrentTool] = useState<{ name: string; args: any; id: string } | null>(null);
  const [thinkingMessage, setThinkingMessage] = useState('Leon AI 正在思考与规划...');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState<'all' | 'docs' | 'proto'>('all');
  const [exportResult, setExportResult] = useState<{ download_url: string; size_bytes: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  
  // Viewport Device
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'Global Context': true,
    'Feature Plan': true,
    'Style Guide': true,
    'Screen & Prototype': true,
    'Prompts': true,
    'word': true,
  });

  // Toggles for explorer and chat panels
  const [showSidebar, setShowSidebar] = useState<boolean>(() => {
    const saved = localStorage.getItem('leon_show_sidebar');
    return saved !== null ? saved === 'true' : true;
  });
  const [showChat, setShowChat] = useState<boolean>(() => {
    const saved = localStorage.getItem('leon_show_chat');
    return saved !== null ? saved === 'true' : true;
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('leon_sidebar_width');
    return saved !== null ? parseInt(saved, 10) : 290;
  });

  const isResizingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(180, Math.min(e.clientX, 800));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('leon_sidebar_width', String(sidebarWidth));
  }, [sidebarWidth]);

  const toggleSidebar = () => {
    setShowSidebar(prev => {
      const next = !prev;
      localStorage.setItem('leon_show_sidebar', String(next));
      return next;
    });
  };

  const toggleChat = () => {
    setShowChat(prev => {
      const next = !prev;
      localStorage.setItem('leon_show_chat', String(next));
      return next;
    });
  };

  // Associated File for modification & Attached image/screenshot context
  const [associatedFile, setAssociatedFile] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadTargetFolder, setUploadTargetFolder] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const terminalBottomRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);

  // Dynamic Thinking Messages Cycle
  useEffect(() => {
    if (!isGenerating) {
      setThinkingMessage('Leon AI 正在思考与规划...');
      return;
    }

    const messagesList = [
      'Leon AI 正在理解您的开发需求...',
      '正在分析当前的工作区结构与依赖...',
      '正在检索相关上下文文件...',
      '正在规划代码修改逻辑与工程方案...',
      '正在生成并优化代码实现方案...',
      '正在整理响应并准备写入修改...',
      '正在生成模型最终输出结果...'
    ];

    let index = 0;
    setThinkingMessage(messagesList[0]);

    const interval = setInterval(() => {
      index = (index + 1) % messagesList.length;
      setThinkingMessage(messagesList[index]);
    }, 2500);

    return () => clearInterval(interval);
  }, [isGenerating]);

  // Auto connect when user state changes
  useEffect(() => {
    if (user) {
      connectWS();
      loadFileTree();
      if (user.role === 'admin') {
        loadUsersList();
      }
    } else {
      if (wsRef.current) {
        wsRef.current.close();
      }
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTool]);

  useEffect(() => {
    if (isTerminalOpen) {
      terminalBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalOutput, isTerminalOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginUsername || !loginPassword) {
      setLoginError('请输入用户名 and 密码');
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      if (res.status === 200) {
        const data = await res.json();
        setUser({ username: data.username, role: data.role });
        localStorage.setItem('leon_user', JSON.stringify({ username: data.username, role: data.role }));
        setLoginUsername('');
        setLoginPassword('');
      } else {
        const err = await res.json();
        setLoginError(err.detail || '登录失败，请检查账号密码');
      }
    } catch (e) {
      console.error('Login failed:', e);
      setLoginError('服务器连接失败');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('leon_user');
    setFileTree([]);
    setOpenTabs([]);
    setActiveFile(null);
    setActiveFileContent('');
    setEditorContents({});
    setUnsavedChanges({});
    setViewModes({});
    setUsersList([]);
    setActiveTab('design');
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const connectWS = () => {
    if (!user) return;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/chat?user=${encodeURIComponent(user.username)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      console.log('Connected to backend WebSocket');
      loadFileTree();
    };

    ws.onclose = () => {
      setWsConnected(false);
      console.log('Disconnected from backend WebSocket');
      if (user) {
        setTimeout(connectWS, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'text') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !last.isToolStatus) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + msg.content }
            ];
          } else {
            return [...prev, { role: 'assistant', content: msg.content }];
          }
        });
      } else if (msg.type === 'tool_start') {
        setCurrentTool({ name: msg.name, args: msg.args, id: msg.id });
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `🔧 **正在执行工具**: \`${msg.name}\`...\n\`\`\`json\n${JSON.stringify(msg.args, null, 2)}\n\`\`\``,
            isToolStatus: true
          }
        ]);
      } else if (msg.type === 'tool_end') {
        setCurrentTool(null);
        setMessages((prev) => [
          ...prev,
          {
            role: 'tool',
            name: msg.name,
            tool_call_id: msg.id,
            content: typeof msg.result === 'object' ? JSON.stringify(msg.result, null, 2) : String(msg.result)
          }
        ]);
      } else if (msg.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `❌ **错误**: ${msg.content}` }
        ]);
        setIsGenerating(false);
      } else if (msg.type === 'refresh') {
        loadFileTree();
        if (activeFile && !unsavedChanges[activeFile]) {
          loadFileContent(activeFile);
        }
      } else if (msg.type === 'done') {
        setIsGenerating(false);
      }
    };
  };

  const loadFileTree = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/workspace/tree', {
        headers: { 'X-User': user.username }
      });
      const data = await res.json();
      setFileTree(data);
    } catch (e) {
      console.error('Failed to load file tree:', e);
    }
  };

  const loadFileContent = async (path: string) => {
    if (!user) return;
    setFileLoading(true);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`, {
        signal: controller.signal,
        headers: { 'X-User': user.username }
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      const loadedContent = data.content || '';
      
      setActiveFileContent(loadedContent);
      
      // If we don't have local edit state for this file, set it
      if (editorContents[path] === undefined) {
        setEditorContents(prev => ({ ...prev, [path]: loadedContent }));
      }
      
      // Set default view mode based on file type
      if (viewModes[path] === undefined) {
        const isPreviewable = path.endsWith('.html') || path.endsWith('.prototype.html') || path.endsWith('.md') || path.endsWith('.docx') || path.endsWith('.pptx') || path.endsWith('.pdf') || data.is_image || data.is_binary;
        setViewModes(prev => ({ ...prev, [path]: isPreviewable ? 'preview' : 'code' }));
      }
      
    } catch (e) {
      clearTimeout(timeoutId);
      console.error('Failed to load file content:', e);
      setActiveFileContent('加载文件失败，请检查服务是否正常并重试');
    } finally {
      setFileLoading(false);
    }
  };

  const selectTab = (path: string) => {
    setActiveFile(path);
    loadFileContent(path);
  };

  const openFileInTab = (path: string) => {
    if (!openTabs.includes(path)) {
      setOpenTabs(prev => [...prev, path]);
    }
    selectTab(path);
  };

  const closeTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    
    if (unsavedChanges[path]) {
      const confirmDiscard = window.confirm(`文件 "${path}" 有未保存的修改，确定关闭并丢弃修改吗？`);
      if (!confirmDiscard) return;
    }
    
    const remainingTabs = openTabs.filter(t => t !== path);
    setOpenTabs(remainingTabs);
    
    // Clear states for the closed file
    const newContents = { ...editorContents };
    delete newContents[path];
    setEditorContents(newContents);
    
    const newUnsaved = { ...unsavedChanges };
    delete newUnsaved[path];
    setUnsavedChanges(newUnsaved);
    
    if (activeFile === path) {
      if (remainingTabs.length > 0) {
        const nextActive = remainingTabs[remainingTabs.length - 1];
        setActiveFile(nextActive);
        loadFileContent(nextActive);
      } else {
        setActiveFile(null);
        setActiveFileContent('');
      }
    }
  };

  const saveActiveFile = async () => {
    if (!activeFile || !user) return;
    const contentToSave = editorContents[activeFile] ?? activeFileContent;
    
    try {
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ path: activeFile, content: contentToSave })
      });
      const data = await res.json();
      if (data.success) {
        setUnsavedChanges(prev => ({ ...prev, [activeFile]: false }));
        setActiveFileContent(contentToSave);
        console.log(`Saved ${activeFile} successfully.`);
      } else {
        alert("保存失败: " + data.message);
      }
    } catch (e) {
      alert("保存出错: " + e);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!activeFile) return;
    const newContent = value || '';
    setEditorContents(prev => ({ ...prev, [activeFile]: newContent }));
    
    const hasChanged = newContent !== activeFileContent;
    setUnsavedChanges(prev => ({ ...prev, [activeFile]: hasChanged }));
  };

  const handleCreateFile = async (parentFolder: string = "") => {
    if (!user) return;
    const name = window.prompt("请输入要创建的文件名 (包含后缀, 例如: hello.py, index.html):");
    if (!name) return;
    const targetPath = parentFolder ? `${parentFolder}/${name}` : name;
    
    try {
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ path: targetPath, content: '' })
      });
      const data = await res.json();
      if (data.success) {
        await loadFileTree();
        openFileInTab(targetPath);
      } else {
        alert("创建文件失败: " + data.message);
      }
    } catch (e) {
      alert("创建文件请求异常: " + e);
    }
  };

  const handleCreateFolder = async (parentFolder: string = "") => {
    if (!user) return;
    const name = window.prompt("请输入文件夹名称:");
    if (!name) return;
    const targetPath = parentFolder ? `${parentFolder}/${name}` : name;
    
    try {
      const res = await fetch('/api/workspace/folder', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ path: targetPath })
      });
      const data = await res.json();
      if (data.success) {
        await loadFileTree();
      } else {
        alert("创建文件夹失败: " + data.message);
      }
    } catch (e) {
      alert("创建文件夹请求异常: " + e);
    }
  };

  const handleRenamePath = async (oldPath: string) => {
    if (!user) return;
    const defaultName = oldPath.split('/').pop() || oldPath;
    const newName = window.prompt("请输入新名称 (若在子目录下重命名，请仅输入新文件名/文件夹名):", defaultName);
    if (!newName || newName === defaultName) return;
    
    const parts = oldPath.split('/');
    parts.pop();
    parts.push(newName);
    const newPath = parts.join('/');
    
    try {
      const res = await fetch('/api/workspace/rename', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath })
      });
      const data = await res.json();
      if (data.success) {
        await loadFileTree();
        
        // Update open tabs if the file is open
        if (openTabs.includes(oldPath)) {
          const updatedTabs = openTabs.map(t => t === oldPath ? newPath : t);
          setOpenTabs(updatedTabs);
          
          const newContents = { ...editorContents };
          if (newContents[oldPath] !== undefined) {
            newContents[newPath] = newContents[oldPath];
            delete newContents[oldPath];
          }
          setEditorContents(newContents);
          
          const newUnsaved = { ...unsavedChanges };
          if (newUnsaved[oldPath] !== undefined) {
            newUnsaved[newPath] = newUnsaved[oldPath];
            delete newUnsaved[oldPath];
          }
          setUnsavedChanges(newUnsaved);
          
          const newModes = { ...viewModes };
          if (newModes[oldPath] !== undefined) {
            newModes[newPath] = newModes[oldPath];
            delete newModes[oldPath];
          }
          setViewModes(newModes);
          
          if (activeFile === oldPath) {
            setActiveFile(newPath);
            loadFileContent(newPath);
          }
        }
      } else {
        alert("重命名失败: " + data.message);
      }
    } catch (e) {
      alert("重命名请求异常: " + e);
    }
  };

  const handleDeleteFile = async (e: React.MouseEvent, path: string, isDir: boolean) => {
    e.stopPropagation();
    if (!user) return;
    const confirmMsg = `确定要删除 ${isDir ? '文件夹' : '文件'} "${path}" 吗？此操作不可撤销！`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
        headers: { 'X-User': user.username }
      });
      const data = await res.json();
      if (data.success) {
        loadFileTree();
        
        // Remove from tabs
        const remainingTabs = openTabs.filter(t => t !== path && !t.startsWith(path + '/'));
        setOpenTabs(remainingTabs);
        
        if (activeFile === path || (activeFile && activeFile.startsWith(path + '/'))) {
          if (remainingTabs.length > 0) {
            const nextActive = remainingTabs[remainingTabs.length - 1];
            setActiveFile(nextActive);
            loadFileContent(nextActive);
          } else {
            setActiveFile(null);
            setActiveFileContent('');
          }
        }
      } else {
        alert('删除失败: ' + data.message);
      }
    } catch (e) {
      console.error('Failed to delete file:', e);
      alert('请求删除出错');
    }
  };

  const handleDownloadFileDirectly = (filePath: string) => {
    if (!user) return;
    const url = `/api/workspace/download?path=${encodeURIComponent(filePath)}&user=${encodeURIComponent(user.username)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filePath.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
 
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) return;
 
    const formData = new FormData();
    formData.append('file', file);
 
    try {
      const resp = await fetch(`/api/workspace/upload?folder=${encodeURIComponent(uploadTargetFolder)}`, {
        method: 'POST',
        headers: {
          'X-User': user.username
        },
        body: formData
      });
      const data = await resp.json();
      if (data.success) {
        alert(`文件 "${file.name}" 上传成功，已保存至目标工作区目录！`);
        loadFileTree();
        const uploadedPath = uploadTargetFolder ? `${uploadTargetFolder}/${file.name}` : file.name;
        openFileInTab(uploadedPath);
      } else {
        alert(`上传失败: ${data.detail || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`上传出错: ${err.message}`);
    } finally {
      e.target.value = '';
      setUploadTargetFolder('');
    }
  };

  const handleClearWorkspace = async () => {
    if (!user) return;
    const confirmClear = window.confirm(
      "确定要清空当前工作区中的所有文件和文件夹吗？此操作无法撤销！"
    );
    if (!confirmClear) return;

    try {
      const resp = await fetch('/api/workspace/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User': user.username
        }
      });
      const data = await resp.json();
      if (data.success) {
        alert("工作区已成功清空！");
        loadFileTree();
        setOpenTabs([]);
        setActiveFile(null);
        setActiveFileContent('');
        setEditorContents({});
        setUnsavedChanges({});
        setViewModes({});
        setAssociatedFile(null);
      } else {
        alert(`清空失败: ${data.detail || '未知错误'}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`网络或服务器错误: ${err.message}`);
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || isGenerating || !user) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('WebSocket 未连接，请等待服务器启动！');
      return;
    }

    const currentAssociatedFile = associatedFile;
    const filename = currentAssociatedFile ? (currentAssociatedFile.split('/').pop() || currentAssociatedFile) : '';
    const finalContent = currentAssociatedFile 
      ? `${inputMessage}\n\n*(指定修改文件: ${filename})*` 
      : inputMessage;

    const nextUserMsg: Message = { 
      role: 'user', 
      content: finalContent,
      ...(attachedImage ? { image: attachedImage } : {})
    };

    const newMessages = [...messages, nextUserMsg];
    setMessages(newMessages);
    setInputMessage('');
    setAttachedImage(null);
    setAssociatedFile(null); // Unpin the file for the next turn
    setIsGenerating(true);

    const wsMessages = newMessages
      .filter((m) => !m.isToolStatus)
      .map((m) => {
        if (m.role === 'user' && m.image) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: m.image } }
            ]
          };
        }
        return {
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.name ? { name: m.name } : {})
        };
      });

    ws.send(JSON.stringify({
      messages: wsMessages,
      associated_file: currentAssociatedFile
    }));
  };

  const handleStopGeneration = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'stop'
      }));
    }
    setIsGenerating(false);
    setCurrentTool(null);
  };

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch('/api/workspace/export', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ type: exportType })
      });
      const data = await res.json();
      if (data.success) {
        setExportResult(data);
      } else {
        alert('导出失败: ' + data.detail);
      }
    } catch (e) {
      console.error('Export failed:', e);
      alert('导出请求出错');
    } finally {
      setExporting(false);
    }
  };

  // --- Terminal execution Action ---
  const handleExecuteTerminalCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalCommand.trim() || !user || isTerminalRunning) return;
    
    const cmd = terminalCommand;
    setTerminalCommand('');
    setIsTerminalRunning(true);
    setTerminalOutput(prev => prev + `$ ${cmd}\n`);
    
    try {
      const res = await fetch('/api/workspace/terminal', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify({ command: cmd })
      });
      const data = await res.json();
      let output = '';
      if (data.stdout) output += data.stdout;
      if (data.stderr) output += data.stderr;
      if (output === '' && data.code === 0) {
        output = '[Command completed successfully]\n';
      }
      if (data.code !== 0 && output === '') {
        output = `[Command exited with error code ${data.code}]\n`;
      }
      setTerminalOutput(prev => prev + output);
    } catch (err: any) {
      setTerminalOutput(prev => prev + `Error executing command: ${err.message}\n`);
    } finally {
      setIsTerminalRunning(false);
    }
  };

  const clearTerminalOutput = () => {
    setTerminalOutput('Leon AI Terminal v1.0.0\nType commands below. Cwd is locked inside your workspace.\n\n');
  };

  // --- Admin User Management actions ---

  const loadUsersList = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'X-User': user.username }
      });
      if (res.status === 200) {
        const data = await res.json();
        setUsersList(data);
      }
    } catch (e) {
      console.error('Failed to load users list:', e);
    }
  };

  const handleCreateOrUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') return;
    if (!adminFormUser.username || !adminFormUser.password) {
      alert('请填写完整的用户名和密码');
      return;
    }

    try {
      let url = '/api/admin/users';
      let method = 'POST';
      
      if (editingUserId !== null) {
        url = `/api/admin/users/${editingUserId}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'X-User': user.username
        },
        body: JSON.stringify(adminFormUser)
      });

      if (res.status === 200) {
        alert(editingUserId ? '修改成功' : '新增成功');
        setAdminFormUser({ username: '', password: '', role: 'user' });
        setEditingUserId(null);
        loadUsersList();
      } else {
        const err = await res.json();
        alert('操作失败: ' + (err.detail || '未知错误'));
      }
    } catch (e) {
      console.error('Admin submit user failed:', e);
      alert('请求异常');
    }
  };

  const handleEditUserClick = (target: UserAccount) => {
    setEditingUserId(target.id);
    setAdminFormUser({
      username: target.username,
      password: target.password || '',
      role: target.role
    });
  };

  const handleDeleteUserClick = async (targetId: number, targetName: string) => {
    if (!user || user.role !== 'admin') return;
    if (targetName === 'admin') {
      alert('无法删除系统默认管理员 admin');
      return;
    }
    if (!window.confirm(`确定删除用户 "${targetName}" 吗？其对应的物理文件夹将依然保留，但该账号将无法再登录。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${targetId}`, {
        method: 'DELETE',
        headers: { 'X-User': user.username }
      });
      if (res.status === 200) {
        alert('删除成功');
        loadUsersList();
      } else {
        const err = await res.json();
        alert('删除失败: ' + (err.detail || '未知错误'));
      }
    } catch (e) {
      console.error('Delete user error:', e);
      alert('删除失败，服务可能未连接');
    }
  };

  // Bind Ctrl+S command on Monaco Editor mount
  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    
    // Add command for Save (Ctrl + S)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveActiveFile();
    });
  };

  // Render file tree helper
  const renderFileNode = (node: FileNode) => {
    const isExpanded = expandedFolders[node.name] || false;
    const isSelected = activeFile === node.path;

    const toggleFolder = () => {
      setExpandedFolders((prev) => ({
        ...prev,
        [node.name]: !prev[node.name]
      }));
    };

    if (node.is_dir) {
      return (
        <div key={node.path} className="file-tree-node dir">
          <div className="node-label">
            <div onClick={toggleFolder} className="node-title-wrapper">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {isExpanded ? <FolderOpen size={14} className="folder-icon" /> : <Folder size={14} className="folder-icon" />}
              <span className="node-text">{node.name}</span>
            </div>
            
            <div className="node-actions-hover">
              <button 
                onClick={() => handleCreateFile(node.path)}
                title="新建文件"
              >
                <Plus size={12} />
              </button>
              <button 
                onClick={() => handleCreateFolder(node.path)}
                title="新建子文件夹"
              >
                <FolderOpen size={12} />
              </button>
              <button 
                onClick={() => handleRenamePath(node.path)}
                title="重命名"
              >
                <FileText size={12} />
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setUploadTargetFolder(node.path);
                  const uploadInput = document.getElementById('explorer-upload-input');
                  if (uploadInput) uploadInput.click();
                }}
                title="上传文件到此目录"
              >
                <Upload size={12} />
              </button>
              <button 
                onClick={(e) => handleDeleteFile(e, node.path, true)}
                title="删除文件夹"
                className="btn-delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          {isExpanded && node.children && (
            <div className="node-children">
              {node.children.map(renderFileNode)}
            </div>
          )}
        </div>
      );
    } else {
      const isHtml = node.name.endsWith('.html');
      const isProto = node.name.endsWith('.prototype.html');
      
      let fileIcon = <File size={13} />;
      if (isHtml) fileIcon = <FileCode size={13} className="html-icon" />;
      if (isProto) fileIcon = <Play size={13} className="proto-icon" />;
 
      const isPinned = associatedFile === node.path;
      const isModified = unsavedChanges[node.path] || false;
 
      return (
        <div 
          key={node.path} 
          className={`file-tree-node file ${isSelected ? 'active' : ''} ${isPinned ? 'pinned' : ''}`}
          onClick={() => openFileInTab(node.path)}
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', node.path);
          }}
        >
          <div className="node-label">
            <div className="node-title-wrapper">
              {fileIcon}
              <span className="node-text">{node.name}</span>
              {isModified && <span className="modified-dot" />}
            </div>
            
            <div className="node-actions-hover">
              <button 
                className={`btn-pin-file ${isPinned ? 'pinned' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setAssociatedFile(isPinned ? null : node.path);
                }}
                title={isPinned ? "取消指定修改" : "指定修改此文件"}
              >
                <Pin size={12} />
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleRenamePath(node.path);
                }}
                title="重命名"
              >
                <FileText size={12} />
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadFileDirectly(node.path);
                }}
                title="下载文件"
              >
                <Download size={12} />
              </button>
              <button 
                onClick={(e) => handleDeleteFile(e, node.path, false)}
                title="删除文件"
                className="btn-delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      );
    }
  };

  // Render Login state view
  if (!user) {
    return (
      <div className="login-backdrop">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">
            <div className="login-logo-icon"><Sparkles size={24} /></div>
            <h1>Leon AI</h1>
            <p>Leon 多用户原型系统登录</p>
          </div>
          
          {loginError && <div className="login-error">{loginError}</div>}
          
          <div className="login-form">
            <div className="form-group">
              <label>用户名 (Username)</label>
              <input 
                type="text" 
                placeholder="请输入用户名" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>密码 (Password)</label>
              <input 
                type="password" 
                placeholder="请输入密码" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-login">登录 (Login)</button>
          </div>
        </form>
      </div>
    );
  }

  const activeViewMode = activeFile ? (viewModes[activeFile] || 'preview') : 'preview';
  const isHtml = activeFile?.endsWith('.html');
  const isProto = activeFile?.endsWith('.prototype.html');
  const isMd = activeFile?.endsWith('.md') || activeFile?.endsWith('.docx') || activeFile?.endsWith('.pptx');
  const isPdf = activeFile?.endsWith('.pdf');
  const isImageFile = activeFileContent.startsWith('data:image/');

  const showPreviewToggle = activeFile && (isHtml || isProto || isMd || isPdf || isImageFile);

  let deviceWidth = '100%';
  if (device === 'tablet') deviceWidth = '768px';
  if (device === 'mobile') deviceWidth = '390px';

  return (
    <div className="app-container">
      {/* Top Header navbar */}
      <header className="navbar">
        <div className="nav-logo">
          <div className="logo-icon"><Sparkles size={18} /></div>
          <div className="logo-title">
            <h1>Leon AI</h1>
            <span className="logo-subtitle">Lightweight Dev Tool</span>
          </div>
        </div>

        {/* Admin Tabs */}
        {user.role === 'admin' && (
          <div style={{ display: 'flex', gap: '8px', marginLeft: '32px' }}>
            <button 
              className={`btn-nav-tab ${activeTab === 'design' ? 'active' : ''}`}
              onClick={() => setActiveTab('design')}
            >
              <Sparkles size={14} />
              <span>应用开发台</span>
            </button>
            <button 
              className={`btn-nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('admin');
                loadUsersList();
              }}
            >
              <Users size={14} />
              <span>用户配置</span>
            </button>
          </div>
        )}

        {activeTab === 'design' && (
          <div className="nav-controls">
            <button 
              className={`btn-toggle ${showSidebar ? 'active' : ''}`} 
              onClick={toggleSidebar} 
              title={showSidebar ? "隐藏文件浏览器" : "显示文件浏览器"}
            >
              <PanelLeft size={14} />
              <span>文件浏览器</span>
            </button>
            <button 
              className={`btn-toggle ${showChat ? 'active' : ''}`} 
              onClick={toggleChat}
              title={showChat ? "隐藏AI助手" : "显示AI助手"}
            >
              <MessageSquare size={14} />
              <span>AI 助手</span>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="nav-status">
            <div className={`status-dot ${wsConnected ? 'online' : 'offline'}`} />
            <span>{wsConnected ? '服务在线' : '重连中'}</span>
          </div>

          <div className="nav-user-info">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="nav-user-name">{user.username}</span>
              <span style={{ fontSize: '10px', color: 'var(--primary)', fontWeight: 500, textTransform: 'uppercase' }}>
                {user.role === 'admin' ? '管理员' : '普通用户'}
              </span>
            </div>
            <button className="btn-logout" onClick={handleLogout} title="退出登录">
              <LogOut size={16} />
            </button>
          </div>

          {activeTab === 'design' && (
            <button className="btn-export" onClick={() => { setExportOpen(true); setExportResult(null); }}>
              <Download size={16} />
              <span>导出项目</span>
            </button>
          )}
        </div>
      </header>

      {/* Admin Tab View */}
      {activeTab === 'admin' && user.role === 'admin' ? (
        <section className="admin-tab-container">
          <div className="admin-header">
            <h2>用户账号管理面板</h2>
          </div>
          
          <div className="admin-grid">
            {/* Left table of users */}
            <div className="user-list-card">
              <h3>已有用户列表</h3>
              <table className="user-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>用户名</th>
                    <th>密码 (明文)</th>
                    <th>角色</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td><strong>{u.username}</strong></td>
                      <td style={{ fontFamily: 'monospace' }}>{u.password}</td>
                      <td>
                        <span className={`badge-role ${u.role}`}>
                          {u.role === 'admin' ? '管理员' : '普通用户'}
                        </span>
                      </td>
                      <td>{u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</td>
                      <td>
                        <button 
                          className="btn-table-action edit"
                          onClick={() => handleEditUserClick(u)}
                        >
                          编辑
                        </button>
                        {u.username !== 'admin' && (
                          <button 
                            className="btn-table-action delete"
                            onClick={() => handleDeleteUserClick(u.id, u.username)}
                          >
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right create/edit user form */}
            <div className="user-form-card">
              <h3>{editingUserId !== null ? '编辑用户数据' : '新增用户账号'}</h3>
              <form onSubmit={handleCreateOrUpdateUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label>用户名</label>
                  <input 
                    type="text"
                    required
                    placeholder="请输入新用户名"
                    value={adminFormUser.username}
                    onChange={(e) => setAdminFormUser({ ...adminFormUser, username: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>密码</label>
                  <input 
                    type="text"
                    required
                    placeholder="请输入密码"
                    value={adminFormUser.password}
                    onChange={(e) => setAdminFormUser({ ...adminFormUser, password: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>用户角色</label>
                  <select
                    value={adminFormUser.role}
                    onChange={(e) => setAdminFormUser({ ...adminFormUser, role: e.target.value })}
                  >
                    <option value="user">普通用户 (user)</option>
                    <option value="admin">管理员 (admin)</option>
                  </select>
                </div>
                
                <div className="user-form-buttons">
                  <button type="submit" className="btn-primary-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={16} />
                    <span>{editingUserId !== null ? '保存修改' : '确认新增'}</span>
                  </button>
                  {editingUserId !== null && (
                    <button 
                      type="button" 
                      className="btn-cancel"
                      onClick={() => {
                        setEditingUserId(null);
                        setAdminFormUser({ username: '', password: '', role: 'user' });
                      }}
                    >
                      取消编辑
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </section>
      ) : (
        /* Design Tab View: Explorer (Left) | Editor + Preview + Terminal (Middle) | AI Assistant Chat (Right) */
        <main className="main-layout">
          {/* Left Explorer Sidebar */}
          {showSidebar && (
            <>
              <section className="sidebar" style={{ width: sidebarWidth }}>
                <div className="panel-header">
                  <h2>工作区浏览器</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button className="btn-refresh" onClick={() => handleCreateFile("")} title="新建根目录文件">
                      <Plus size={14} />
                    </button>
                    <button className="btn-refresh" onClick={() => handleCreateFolder("")} title="新建根目录文件夹">
                      <Folder size={14} />
                    </button>
                    <label className="btn-refresh" title="上传文件到根目录" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Upload size={14} />
                      <input 
                        id="explorer-upload-input"
                        type="file" 
                        style={{ display: 'none' }} 
                        onChange={handleUploadFile}
                      />
                    </label>
                    <button className="btn-refresh" onClick={handleClearWorkspace} title="清空整个工作区" style={{ color: '#ef4444' }}>
                      <Trash2 size={14} />
                    </button>
                    <button className="btn-refresh" onClick={loadFileTree} title="刷新">
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>
                
                <div className="explorer-tree">
                  {fileTree.length > 0 ? (
                    fileTree.map(renderFileNode)
                  ) : (
                    <div className="empty-tree">工作区目录为空。</div>
                  )}
                </div>
              </section>
              <div className="sidebar-resizer" onMouseDown={handleMouseDown} />
            </>
          )}

          {/* Middle Editor Tab Panel + Preview Canvas + Terminal Panel */}
          <section className="editor-canvas-container">
            {/* Editor Tabs Header bar */}
            {openTabs.length > 0 ? (
              <div className="editor-tabs-bar">
                <div className="tabs-scroller">
                  {openTabs.map(tabPath => {
                    const isTabActive = activeFile === tabPath;
                    const isTabModified = unsavedChanges[tabPath] || false;
                    const tabName = tabPath.split('/').pop() || tabPath;
                    return (
                      <div 
                        key={tabPath}
                        className={`editor-tab ${isTabActive ? 'active' : ''}`}
                        onClick={() => selectTab(tabPath)}
                      >
                        <span className="tab-name" title={tabPath}>{tabName}</span>
                        {isTabModified && <span className="tab-modified-dot" />}
                        <button 
                          className="btn-tab-close" 
                          onClick={(e) => closeTab(e, tabPath)}
                          title="关闭标签页"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="tabs-actions">
                  <button 
                    className={`btn-terminal-toggle ${isTerminalOpen ? 'active' : ''}`}
                    onClick={() => setIsTerminalOpen(prev => !prev)}
                    title={isTerminalOpen ? "收起终端" : "展开终端"}
                  >
                    <Terminal size={14} />
                    <span>终端</span>
                  </button>
                </div>
              </div>
            ) : null}

            {activeFile ? (
              <div className="editor-canvas-content">
                {/* File Sub-Toolbar */}
                <div className="canvas-toolbar">
                  {showPreviewToggle ? (
                    <div className="view-mode-buttons">
                      <button
                        className={`btn-view-mode ${activeViewMode === 'code' ? 'active' : ''}`}
                        onClick={() => setViewModes(prev => ({ ...prev, [activeFile]: 'code' }))}
                      >
                        代码编辑
                      </button>
                      <button
                        className={`btn-view-mode ${activeViewMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setViewModes(prev => ({ ...prev, [activeFile]: 'preview' }))}
                      >
                        视图预览
                      </button>
                    </div>
                  ) : <div />}

                  {activeViewMode === 'preview' && (isHtml || isProto) && (
                    <div className="viewport-buttons">
                      <button 
                        className={`btn-device ${device === 'desktop' ? 'active' : ''}`}
                        onClick={() => setDevice('desktop')}
                        title="Desktop (1440px)"
                      >
                        <Monitor size={14} />
                      </button>
                      <button 
                        className={`btn-device ${device === 'tablet' ? 'active' : ''}`}
                        onClick={() => setDevice('tablet')}
                        title="Tablet (768px)"
                      >
                        <Tablet size={14} />
                      </button>
                      <button 
                        className={`btn-device ${device === 'mobile' ? 'active' : ''}`}
                        onClick={() => setDevice('mobile')}
                        title="Mobile (390px)"
                      >
                        <Smartphone size={14} />
                      </button>
                    </div>
                  )}

                  <div className="toolbar-actions">
                    <button
                      className={`btn-toolbar-save ${unsavedChanges[activeFile] ? 'modified' : ''}`}
                      onClick={saveActiveFile}
                      disabled={!unsavedChanges[activeFile]}
                      title="保存文件 (Ctrl + S)"
                    >
                      <Save size={14} />
                      <span>保存</span>
                    </button>

                    <button
                      className={`btn-toolbar-pin ${associatedFile === activeFile ? 'active' : ''}`}
                      onClick={() => {
                        setAssociatedFile(associatedFile === activeFile ? null : activeFile);
                      }}
                      title={associatedFile === activeFile ? "取消指定修改" : "指定修改此文件"}
                    >
                      <Pin size={14} />
                      <span>{associatedFile === activeFile ? '已指定修改' : '指定修改'}</span>
                    </button>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="canvas-content">
                  {fileLoading ? (
                    <div className="file-loading">
                      <div className="spinner" />
                      <span>加载中...</span>
                    </div>
                  ) : activeViewMode === 'code' ? (
                    <div className="monaco-container">
                      <Editor 
                        height="100%" 
                        language={getLanguageByExtension(activeFile)}
                        theme="vs-dark" 
                        value={editorContents[activeFile] ?? activeFileContent}
                        onChange={handleEditorChange}
                        onMount={handleEditorMount}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          tabSize: 4,
                          lineNumbers: 'on',
                          wordWrap: 'on',
                          scrollBeyondLastLine: false,
                          automaticLayout: true
                        }}
                      />
                    </div>
                  ) : isHtml || isProto ? (
                    <div className="iframe-wrapper" style={{ width: deviceWidth }}>
                      <iframe 
                        title="Canvas Frame"
                        srcDoc={resolveRelativeSrc(editorContents[activeFile] ?? activeFileContent, activeFile || '', user.username)}
                        sandbox="allow-scripts allow-same-origin"
                      />
                    </div>
                  ) : isMd ? (
                    <MarkdownPreview content={editorContents[activeFile] ?? activeFileContent} filePath={activeFile || ''} />
                  ) : isPdf ? (
                    <div className="pdf-wrapper" style={{ width: '100%', height: '100%' }}>
                      <iframe
                        title="PDF Viewer"
                        src={`/api/workspace/file/raw?path=${encodeURIComponent(activeFile)}&user=${encodeURIComponent(user.username)}`}
                        style={{ width: '100%', height: '100%', border: 'none', borderRadius: '12px' }}
                      />
                    </div>
                  ) : isImageFile ? (
                    <div className="image-preview-container">
                      <div className="image-frame">
                        <img 
                          src={editorContents[activeFile] ?? activeFileContent} 
                          alt="Preview" 
                        />
                      </div>
                      <div className="image-caption">
                        {activeFile}
                      </div>
                    </div>
                  ) : (
                    <pre className="code-fallback"><code>{editorContents[activeFile] ?? activeFileContent}</code></pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="canvas-splash">
                <div className="splash-card">
                  <div className="splash-icon">🎨</div>
                  <h2>Leon 仿真开发工作区</h2>
                  <p>在左侧双击打开代码或设计文档。</p>
                  <p>中间展示 Monaco 编辑器，支持 Ctrl+S 实时保存代码、拖拽与上传支持。</p>
                  <p className="subtext">支持终端命令执行以及双向隔离，右侧与 AI 交互更高效！</p>
                </div>
              </div>
            )}

            {/* Bottom Collapsible Terminal console */}
            <div className={`terminal-panel ${isTerminalOpen ? 'open' : ''}`}>
              <div className="terminal-header" onClick={() => setIsTerminalOpen(prev => !prev)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Terminal size={14} />
                  <h3>执行终端 CMD (Cwd: workspace/leon/{user.username})</h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn-terminal-clear" onClick={clearTerminalOutput}>清空输出</button>
                  <button className="btn-terminal-close" onClick={() => setIsTerminalOpen(false)}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {isTerminalOpen && (
                <div className="terminal-body">
                  <pre className="terminal-console-output">
                    {terminalOutput}
                    {isTerminalRunning && <span className="terminal-loading-dot">█</span>}
                    <div ref={terminalBottomRef} />
                  </pre>
                  <form onSubmit={handleExecuteTerminalCommand} className="terminal-input-row">
                    <span className="terminal-prompt">$</span>
                    <input 
                      type="text"
                      className="terminal-cmd-input"
                      placeholder="输入命令并回车，例如: python run.py (支持任意命令运行)"
                      value={terminalCommand}
                      onChange={(e) => setTerminalCommand(e.target.value)}
                      disabled={isTerminalRunning}
                    />
                  </form>
                </div>
              )}
            </div>
          </section>

          {/* Right Chat Panel */}
          {showChat && (
            <section 
              className={`chat-panel ${isDraggingOver ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                
                const filePath = e.dataTransfer.getData('text/plain');
                if (filePath && (filePath.indexOf('workspace/') !== -1 || filePath.endsWith('.html') || filePath.endsWith('.md'))) {
                  setAssociatedFile(filePath);
                  return;
                }
                
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                  const file = files[0];
                  if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setAttachedImage(event.target?.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }
              }}
            >
              <div className="panel-header">
                <h2>AI 交互助手</h2>
              </div>

              <div className="chat-history">
                {messages
                  .filter((m) => !m.isToolStatus && m.role !== 'tool')
                  .map((m, idx) => {
                    const isAssistant = m.role === 'assistant';
                    return (
                      <div key={idx} className={`message ${m.role} animate-fade-in`}>
                        <div className="msg-avatar">
                          {isAssistant ? <Bot size={18} /> : <User size={18} />}
                        </div>
                        <div className="msg-bubble">
                          <div className="msg-content markdown" dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }} />
                          {m.image && (
                            <div className="chat-message-image-container">
                              <img src={m.image} alt="User Screenshot" className="chat-message-image" onClick={() => window.open(m.image)} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {isGenerating && (
                  currentTool ? (
                    <div className="message tool-status animate-pulse-slow" style={{
                      backgroundColor: 'rgba(102, 252, 241, 0.06)',
                      border: '1px solid rgba(102, 252, 241, 0.15)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      margin: '12px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}>
                      <div className="msg-header" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: 'var(--primary)',
                        fontWeight: 600,
                        fontSize: '13px'
                      }}>
                        <Terminal size={14} className="animate-spin-slow" />
                        <span>
                          {currentTool.name === 'run_terminal_command' ? `正在运行终端命令: ${currentTool.args?.command || ''}` :
                           currentTool.name === 'write_workspace_file' ? `正在写入文件: ${currentTool.args?.path || ''}` :
                           currentTool.name === 'read_workspace_file' ? `正在读取文件: ${currentTool.args?.path || ''}` :
                           currentTool.name === 'list_dir' ? `正在列出目录: ${currentTool.args?.path || '根目录'}` :
                           currentTool.name === 'create_folder' ? `正在创建目录: ${currentTool.args?.path || ''}` :
                           `正在执行工具: ${currentTool.name}...`}
                        </span>
                      </div>
                      {currentTool.args && Object.keys(currentTool.args).length > 0 && (
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {currentTool.name === 'run_terminal_command' ? (
                            <span>$ {currentTool.args.command}</span>
                          ) : currentTool.name === 'write_workspace_file' ? (
                            <span>写入 {currentTool.args.path} ({currentTool.args.content?.length || 0} 字符)</span>
                          ) : (
                            <span>参数: {JSON.stringify(currentTool.args, null, 2)}</span>
                          )}
                        </div>
                      )}
                      <div className="progress-bar" style={{
                        height: '4px',
                        width: '100%',
                        backgroundColor: 'rgba(102, 252, 241, 0.1)',
                        borderRadius: '2px',
                        overflow: 'hidden',
                        position: 'relative'
                      }}>
                        <div className="progress-bar-fill" style={{
                          height: '100%',
                          width: '40%',
                          backgroundColor: 'var(--primary)',
                          borderRadius: '2px',
                          animation: 'progressBarMove 1.5s infinite ease-in-out',
                          position: 'absolute',
                          left: 0,
                          top: 0
                        }} />
                      </div>
                    </div>
                  ) : (
                    <div className="message assistant thinking-status" style={{
                      display: 'flex',
                      gap: '12px',
                      margin: '12px 0',
                      alignItems: 'center'
                    }}>
                      <div className="msg-avatar" style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(102, 252, 241, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary)',
                        border: '1px solid rgba(102, 252, 241, 0.15)'
                      }}>
                        <Bot size={16} />
                      </div>
                      <div className="thinking-bubble" style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        padding: '12px 16px',
                        borderRadius: '0 12px 12px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '13px', marginRight: '6px' }}>{thinkingMessage}</span>
                        <div className="typing-dot" style={{ width: '6px', height: '6px', backgroundColor: 'var(--primary)', borderRadius: '50%', animation: 'typingBounce 1.4s infinite ease-in-out', animationDelay: '0s' }} />
                        <div className="typing-dot" style={{ width: '6px', height: '6px', backgroundColor: 'var(--primary)', borderRadius: '50%', animation: 'typingBounce 1.4s infinite ease-in-out', animationDelay: '0.2s' }} />
                        <div className="typing-dot" style={{ width: '6px', height: '6px', backgroundColor: 'var(--primary)', borderRadius: '50%', animation: 'typingBounce 1.4s infinite ease-in-out', animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  )
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat input form */}
              <div className="chat-input-container">
                {(associatedFile || attachedImage) && (
                  <div className="chat-attachments">
                    {associatedFile && (
                      <div className="attachment-badge file">
                        <FileCode size={12} />
                        <span className="badge-text" title={associatedFile}>
                          指定修改: {associatedFile.split('/').pop() || associatedFile}
                        </span>
                        <button className="btn-remove-attachment" onClick={() => setAssociatedFile(null)}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {attachedImage && (
                      <div className="attachment-badge image">
                        <div className="image-preview-thumbnail">
                          <img src={attachedImage} alt="Thumbnail" />
                        </div>
                        <span className="badge-text">截图已添加</span>
                        <button className="btn-remove-attachment" onClick={() => setAttachedImage(null)}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="chat-input-row">
                  <textarea
                    placeholder="描述你想开发的功能、修改代码的细节或执行的流程... (支持拖入文件或粘贴/拖入截图)"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (items) {
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.indexOf('image') !== -1) {
                            const file = items[i].getAsFile();
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                setAttachedImage(event.target?.result as string);
                              };
                              reader.readAsDataURL(file);
                              e.preventDefault();
                              break;
                            }
                          }
                        }
                      }
                    }}
                    rows={2}
                  />
                  
                  <div className="chat-input-actions">
                    <button
                      className={`btn-input-action ${associatedFile === activeFile ? 'active' : ''}`}
                      onClick={() => {
                        if (activeFile) {
                          setAssociatedFile(associatedFile === activeFile ? null : activeFile);
                        } else {
                          alert('请先在左侧选择或打开一个文件');
                        }
                      }}
                      title="关联当前打开的文件"
                      disabled={!activeFile}
                    >
                      <Pin size={14} />
                    </button>

                    <label className="btn-input-action" title="添加截图/图片" style={{ cursor: 'pointer' }}>
                      <Paperclip size={14} />
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setAttachedImage(event.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>

                    {isGenerating ? (
                      <button 
                        className="btn-stop" 
                        onClick={handleStopGeneration}
                        title="停止生成"
                      >
                        <Square size={13} fill="currentColor" />
                      </button>
                    ) : (
                      <button 
                        className="btn-send" 
                        onClick={handleSendMessage} 
                        disabled={!inputMessage.trim()}
                      >
                        <Send size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      )}

      {/* Export ZIP Dialog Modal */}
      {exportOpen && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h2>导出项目 (Export Project ZIP)</h2>
              <button className="btn-close" onClick={() => setExportOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                backgroundColor: 'rgba(102, 252, 241, 0.05)',
                border: '1px solid rgba(102, 252, 241, 0.15)',
                padding: '16px',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '14px',
                lineHeight: '1.6'
              }}>
                <strong>即将打包导出整个项目工作区：</strong>
                <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                  <li>打包并压缩工作区内所有的源代码文件与开发资源</li>
                  <li>保留完整的目录层次结构</li>
                  <li>支持一键下载为标准的 ZIP 归档文件</li>
                </ul>
              </div>

              {exportResult && (
                <div className="export-result animate-fade-in">
                  <CheckCircle size={20} className="success-icon" />
                  <div className="result-info">
                    <h4>打包成功！</h4>
                    <p>文件大小: {(exportResult.size_bytes / 1024).toFixed(1)} KB</p>
                    <a 
                      href={exportResult.download_url} 
                      download 
                      className="btn-download"
                    >
                      <Download size={16} />
                      <span>下载 ZIP 归档文件</span>
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setExportOpen(false)}>取消</button>
              <button 
                className="btn-primary-action" 
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? '正在打包...' : '开始导出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
