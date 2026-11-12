-- 允许长行内代码在 / : - 处断行，避免顶出版心
local function escape_tex(s)
  s = s:gsub('\\', '\1')
  s = s:gsub('{', '\\{')
  s = s:gsub('}', '\\}')
  s = s:gsub('_', '\\_')
  s = s:gsub('#', '\\#')
  s = s:gsub('%$', '\\$')
  s = s:gsub('%%', '\\%')
  s = s:gsub('&', '\\&')
  s = s:gsub('~', '\\textasciitilde{}')
  s = s:gsub('%^', '\\textasciicircum{}')
  s = s:gsub('\1', '\\textbackslash{}')
  return s
end

function Code(el)
  local s = el.text
  if #s < 16 then return nil end
  s = escape_tex(s)
  s = s:gsub('([/:%-])', '%1\\allowbreak{}')
  return pandoc.RawInline('latex', '\\texttt{' .. s .. '}')
end
