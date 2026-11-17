import { zipSync } from 'fflate'

/** 用户拖进来的可能是 ZIP、解压后的文件夹，或者散落的几个文件；统一转成一个 ZIP 交给导入器 */

const readAllEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
          return
        }
        all.push(...batch)
        next()
      }, reject)
    next()
  })

const readFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject))

const collectEntry = async (
  entry: FileSystemEntry,
  prefix: string,
  out: Record<string, Uint8Array>
): Promise<void> => {
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry)
    out[`${prefix}${entry.name}`] = new Uint8Array(await file.arrayBuffer())
    return
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader())
    for (const child of children) {
      await collectEntry(child, `${prefix}${entry.name}/`, out)
    }
  }
}

const toFile = (files: Record<string, Uint8Array>, name: string): File =>
  new File([zipSync(files) as unknown as BlobPart], name, { type: 'application/zip' })

/**
 * 把拖放内容归一成一个 ZIP 文件。
 * 文件夹会递归打包（常见误操作：把导出的 ZIP 解压了再拖进来）；
 * 多个散文件也打包，交给导入器判断格式。无法识别时返回 null。
 */
export const fileFromDrop = async (transfer: DataTransfer): Promise<File | null> => {
  const items = Array.from(transfer.items).filter((item) => item.kind === 'file')
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry)

  const singleDirectory = entries.length === 1 && entries[0].isDirectory
  if (singleDirectory) {
    const out: Record<string, Uint8Array> = {}
    await collectEntry(entries[0], '', out)
    return toFile(out, 'imported-folder.zip')
  }

  return fileFromFiles(transfer.files)
}

/** 选择文件/文件夹后同样归一：单个 ZIP 直接用，其余打包 */
export const fileFromFiles = async (files: FileList | File[]): Promise<File | null> => {
  const list = Array.from(files)
  if (list.length === 0) {
    return null
  }
  if (list.length === 1) {
    return list[0]
  }
  const out: Record<string, Uint8Array> = {}
  for (const file of list) {
    // 文件夹选择器给出的相对路径有助于保留目录结构
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    out[relative && relative.length > 0 ? relative : file.name] = new Uint8Array(
      await file.arrayBuffer()
    )
  }
  return toFile(out, 'imported-files.zip')
}
