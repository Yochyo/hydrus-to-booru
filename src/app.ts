import { SzurubooruApi } from '../../szurubooru-api/src/szurubooru-api';
import { HydrusApi } from '../../hydrus-api/src/hydrus-api';
import { FileMetadataResponse } from '../../hydrus-api/src/api/get-files/types';
import sharp from 'sharp';

type Tag = {name: string, category: string}

const INCLUDE_LEVEL = 1

const api = new HydrusApi({host: 'http://localhost:45869/', accessKey: '1961a1878a2e8f8899ac992805b8daa415fbc514f412966f26e7c59318e9f876'})
const szuru = new SzurubooruApi({host: 'http://localhost:8080/api/', username: 'admin', password: 'habdichlieb'})

const getRelevantTags = (meta: FileMetadataResponse): Record<number, Tag[]> => {
  const modifyTagsWithSameName = (input: Record<number, Tag[]>) => {
    const tags = Object.values(input).flat()
    const map = new Map<string, Set<string>>()
    tags.forEach(tag => {
      if(tag.category != 'sherrybooru') {
        if(map.has(tag.name)) map.get(tag.name)!.add(tag.category)
        else map.set(tag.name, new Set([tag.category]))
      }
    })
    const tagNamesToRename: string[] = []
    for (let entry of map.entries()) {
      if(entry[1].size > 1) {
        tagNamesToRename.push(entry[0])
      }
    }
    return Object.fromEntries(Object.entries(input).map(entry => [entry[0], entry[1].map(tag => tagNamesToRename.includes(tag.name) ? ({name: `${tag.name}_(${tag.category})`, category: tag.category}) : tag)]))
  }

  const allowedNamespaces = ['default', 'creator', 'meta', 'character', 'series', 'sherrybooru']

  const tags = meta.metadata.map(meta => meta.tags)
  const myTags = tags.map(tagObj => Object.fromEntries(Object.entries(tagObj).filter(entry => entry[0] == '6c6f63616c2074616773'))) // only use "my tags"
  const myTagsStorage = myTags.map(it => Object.values(it).flatMap(it => it.storage_tags['0']).filter(it => it) as string[])
  const res = myTagsStorage.map(tags => tags.map(tag => ({category: tag.includes(':') ? tag.substring(0, tag.indexOf(':')) : 'default', name: (tag.includes(':') ? tag.substring(tag.indexOf(':') + 1) : tag).replaceAll(' ', "_")})).filter(tag => allowedNamespaces.includes(tag.category)))
  const relevantTags =  Object.fromEntries(meta.metadata.map((it, i) => [it.file_id, res[i]]))
  return modifyTagsWithSameName(relevantTags)

}

const createTags = async (szuru: SzurubooruApi, tags: Tag[]) => {
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
    // todo stringify does not respect field order, use something else
    const uniqueTags = Array.from(new Set(tags.map((o) => JSON.stringify(o)))).map((s) => JSON.parse(s))

    await Promise.all(tags.map(tag => szuru.createTag({payload: {category: tag.category, names: [tag.name]}}).catch((it: any) => it)))
  }
  await createNS()
  await createTags()
}

const uploadImage = async (meta: FileMetadataResponse['metadata'][0], tags: Tag[]) => {
  const calcDimensions = () => {
    const regex = /^res(-(\d+))?(=(\d*)x(\d*))?$/
    const {width, height}: {width?: number, height?: number} = {}
    const resolutionTags = tags.filter(tag => tag.category == 'sherrybooru' && regex.test(tag.name))
    const resolutions: {level: number, width?: number, height?: number} = resolutionTags.map(tag => tag.name.match(regex)).map(it => ({level: +(it![2] ?? 1), width: it![4] == undefined ? undefined : +(it![4]), height: it![5] == '' ? undefined : +(it![5])}))
  }
  const uploadFile = async (meta: FileMetadataResponse, tags: {category: string, name: string}[]) => {

    const file = await api.getFile({hash})
    // todo rating
    await szuru.createPosts({upload: {content: file}, payload:{ tags: tags.map(it => it.name), safety: tags.find(tag => tag.category == 'rating')?.name ?? 'safe', source: meta.metadata[0].known_urls.join('\n')}})
  }
  await uploadFile(meta, tags)
  console.log(tags);
}

void (async  () => {
  const [metas, tags] = await (async () => {
    const fileIds = (await api.searchFiles({ tags: ['sherrybooru:*'] })).file_ids
    const metas = await api.getFileMetadata({file_ids: fileIds})
    let tags = getRelevantTags(metas)
    // exclude images with sherrybooru:exclude and !sherrybooru:include include level too low
    let excludePostsWithIds = Object.keys(tags).map(fileId => +fileId)
    excludePostsWithIds = excludePostsWithIds.filter(fileId => !tags[fileId].some(tag => !(tag.category == 'sherrybooru' && tag.name == 'exclude')))
    excludePostsWithIds = excludePostsWithIds.filter(fileId => !tags[fileId].some(tag => (tag.category == 'sherrybooru' && /^include(-\d+)?$/.test(tag.name))))
    excludePostsWithIds = excludePostsWithIds.filter(fileId => tags[fileId].some(tag => (tag.category == 'sherrybooru' && +(tag.name.match(/^include(-(\d+))?$/)![2] ?? 1) <= INCLUDE_LEVEL)))

    metas.metadata = metas.metadata.filter(meta => !excludePostsWithIds.includes(meta.file_id))
    tags = Object.fromEntries(Object.entries(tags).filter(entry => excludePostsWithIds.includes(+entry[0])))
    return [metas, tags]
  })()
  // create tags and their categories so that posts can use them (or else every tag a post uses has the default category)
  await createTags(szuru, Object.values(tags).flat().filter(it => it.category != 'sherrybooru'))
  return

  await uploadImage('cd4c24717d6d8aae98d803506248a053224af7f3dabf9bf0ffb8d1c2f256f4e8')
  return
  // await Promise.all(mappedTags.filter(it => it.category).map(tag => szuru.createCategory({payload: ({name: tag.category, color: 'white', order: 1})})))
  // await Promise.all(mappedTags.map(tag => szuru.createTag({payload: tag})))
  // await szuru.updatePost({id: 4, payload: {tags: mappedTags.flatMap(it => it.names), version: 2}})
})()




const findTag = (meta: FileMetadataResponse['metadata'][0], str: string): Tag? => {
  const tags = meta.tags
  const myTags = Object.fromEntries(Object.entries(tags).filter(entry => entry[0] == '6c6f63616c2074616773'))
  const myTagsStorage = Object.values(myTags).flatMap(it => it.storage_tags['0']).filter(it => it) as string[]
  const res = myTagsStorage.map(tags => tags.map(tag => ({category: tag.includes(':') ? tag.substring(0, tag.indexOf(':')) : 'default', name: (tag.includes(':') ? tag.substring(tag.indexOf(':') + 1) : tag).replaceAll(' ', "_")})).filter(tag => allowedNamespaces.includes(tag.category)))
  const relevantTags =  Object.fromEntries(meta.metadata.map((it, i) => [it.file_id, res[i]]))

}