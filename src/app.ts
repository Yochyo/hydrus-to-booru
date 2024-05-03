import { SzurubooruApi } from '../../szurubooru-api/src/szurubooru-api';
import { HydrusApi } from '../../hydrus-api/src/hydrus-api';
import { FileMetadataResponse } from '../../hydrus-api/src/api/get-files/types';

type Tag = {name: string, category: string}

const api = new HydrusApi({host: 'http://localhost:45869/', accessKey: '1961a1878a2e8f8899ac992805b8daa415fbc514f412966f26e7c59318e9f876'})
const szuru = new SzurubooruApi({host: 'http://localhost:8080/api/', username: 'admin', password: 'habdichlieb'})

const getRelevantTags = (meta: FileMetadataResponse): Record<number, Tag[]> => {
  const modifyTagsWithSameName = (input: Record<number, Tag[]>) => {
    const tags = Object.values(input).flat()
    const map = new Map<string, Set<string>>()
    tags.forEach(tag => {
      if(map.has(tag.name)) map.get(tag.name)!.add(tag.category)
      else map.set(tag.name, new Set([tag.category]))
    })
    const tagNamesToRename: string[] = []
    for (let entry of map.entries()) {
      if(entry[1].size > 1) {
        tagNamesToRename.push(entry[0])
      }
    }
    return Object.fromEntries(Object.entries(input).map(entry => [entry[0], entry[1].map(tag => tagNamesToRename.includes(tag.name) ? ({name: `${tag.name}_(${tag.category})`, category: tag.category}) : tag)]))
  }

  const allowedNamespaces = ['default', 'creator', 'meta', 'character', 'series']

  const tags = meta.metadata.map(meta => meta.tags)
  const myTags = tags.map(tagObj => Object.fromEntries(Object.entries(tagObj).filter(entry => entry[0] == '6c6f63616c2074616773'))) // only use "my tags"
  const myTagsStorage = myTags.map(it => Object.values(it).flatMap(it => it.storage_tags['0']).filter(it => it) as string[])
  const res = myTagsStorage.map(tags => tags.map(tag => ({category: tag.includes(':') ? tag.substring(0, tag.indexOf(':')) : 'default', name: (tag.includes(':') ? tag.substring(tag.indexOf(':') + 1) : tag).replaceAll(' ', "_")})).filter(tag => allowedNamespaces.includes(tag.category)))
  const relevantTags =  Object.fromEntries(meta.metadata.map((it, i) => [it.file_id, res[i]]))
  return modifyTagsWithSameName(relevantTags)

}

const createTags = async (szuru: SzurubooruApi, tags: Tag[]) => {
  const filterDuplicateTags = () => {
    const map = new Map<string, Set<string>>()
    tags.forEach(tag => {
      if(map.has(tag.name)) map.get(tag.name)!.add(tag.category)
      else map.set(tag.name, new Set(tag.category))
    })
    const uniqueTags: Tag[] = []
    for (let entry of map.entries()) {
      const size = entry[1].size
      if(size > 1) {
        entry[1].forEach(category => uniqueTags.push({name: `${entry[0]}_(${category})`, category}))
      }
      if(size == 1) uniqueTags.push({name: entry[0], category: Array.from(entry[1])[0]})
      else console.warn(`tag ${entry[0]} does not have a category!?!?`)
    }
    return uniqueTags
  }
  const createNS = async () => {
    const ns: Record<string, {color: string, order: number}> = {
      creator: {color: '#a40202', order: 1},
      character: {color: '#01a601', order: 3},
      series: {color: '#9805g98', order: 2},
      meta: {color: '#9805g98', order: 5},
    }
    await szuru.updateCategory({name: 'default', payload: {name: 'default', color: '#006ffa', version: 1, order: 4}}).catch(it => it)
    await szuru.setDefaultCategory({name: 'default'}).catch(it => it)

    await Promise.all(Object.entries(ns).map(entry => szuru.createCategory({payload: {name: entry[0], color: entry[1].color, order: entry[1].order}}).catch(it => it)))
  }
  const createTags = async () => {
    await Promise.all(tags.map(tag => szuru.createTag({payload: {category: tag.category, names: [tag.name]}}).catch(it => it)))
  }
  await createNS()

}

const uploadImage = async (hash: string) => {
  const getTags = (meta: FileMetadataResponse) => {
    const services = meta.metadata[0].tags
    const filtered = Object.fromEntries(Object.entries(services).filter(entry => entry[0] == '6c6f63616c2074616773')) // only use "my tags"
    const tags = Object.values(filtered).flatMap(it => it.storage_tags['0']).filter(it => it) as string[]

    const allowedNamespaces = ['default', 'creator', 'meta', 'character', 'series']
    return tags.map(tag => ({category: tag.includes(':') ? tag.substring(0, tag.indexOf(':')) : 'default', name: tag.includes(':') ? tag.substring(tag.indexOf(':') + 1) : tag})).filter(tag => allowedNamespaces.includes(tag.category))
  }
  const createTags = async (tags: {category: string, name: string}[]) => {
    await Promise.all(tags.map(tag => szuru.createTag({payload: {category: tag.category, names: [tag.name.replaceAll(' ', '_')]}}).catch(it => console.log(`${tag.name} already exists or something like that`))))
  }


  const uploadFile = async (meta: FileMetadataResponse, tags: {category: string, name: string}[]) => {
    const file = await api.getFile({hash})
    // todo rating
    await szuru.createPosts({upload: {content: file}, payload:{ tags: tags.map(it => it.name), safety: tags.find(tag => tag.category == 'rating')?.name ?? 'safe', source: meta.metadata[0].known_urls.join('\n')}})
  }
  const meta = await api.getFileMetadata({hash})
  const tags = getTags(meta).map(tag => ({...tag, name: tag.name.replaceAll(" ", "_")}))
  await createTags(tags)
  await uploadFile(meta, tags)
  console.log(tags);
}

void (async  () => {
  const metas = await api.getFileMetadata({file_ids: (await api.searchFiles({ tags: ['sherrybooru:*'] })).file_ids})
  const tags = getRelevantTags(metas)
  return

  // await createNS(szuru)
  await uploadImage('cd4c24717d6d8aae98d803506248a053224af7f3dabf9bf0ffb8d1c2f256f4e8')
  return
  // await Promise.all(mappedTags.filter(it => it.category).map(tag => szuru.createCategory({payload: ({name: tag.category, color: 'white', order: 1})})))
  // await Promise.all(mappedTags.map(tag => szuru.createTag({payload: tag})))
  // await szuru.updatePost({id: 4, payload: {tags: mappedTags.flatMap(it => it.names), version: 2}})
})()



