"""Read exported ASCII internal fields without VTK float conversion."""
import re
import numpy as np

def internal(case, time, field, count):
    text=(case/f'{time:g}'/field).read_text()
    text=re.sub(r'/\*.*?\*/|//[^\n]*','',text,flags=re.S)
    m=re.search(r'internalField\s+uniform\s+([^;]+);',text)
    if m:
        value=np.fromstring(m[1].translate(str.maketrans('()','  ')),sep=' ')
        return np.full(count,value[0]) if len(value)==1 else np.tile(value,(count,1))
    m=re.search(r'internalField\s+nonuniform\s+List<(scalar|vector)>\s+(\d+)\s*\((.*?)\)\s*;',text,re.S)
    if not m: raise ValueError(f'Unsupported ASCII field {field}')
    values=np.fromstring(m[3].translate(str.maketrans('()','  ')),sep=' ')
    if int(m[2])!=count: raise ValueError('Cell count mismatch')
    return values.reshape(count,3) if m[1]=='vector' else values.reshape(count)
