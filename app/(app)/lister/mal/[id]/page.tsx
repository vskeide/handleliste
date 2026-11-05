import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { TemplateEditor } from './template-editor'

export default async function TemplatePage({ params }: { params: { id: string } }) {
  const householdId = requireSession()
  const supabase = createServiceRoleClient()

  const [tmplRes, linesRes, itemsRes, sectionsRes, storesRes] = await Promise.all([
    supabase
      .from('list_templates')
      .select('id, name, store_id')
      .eq('id', params.id)
      .eq('household_id', householdId)
      .maybeSingle(),
    supabase.from('template_items').select('id, item_id, quantity').eq('template_id', params.id),
    supabase
      .from('items')
      .select('id, name, section_id, times_purchased')
      .eq('household_id', householdId),
    supabase.from('sections').select('id, name_nn, icon, default_sort_order').order('default_sort_order'),
    supabase.from('household_stores').select('stores(id, name, chain)').eq('household_id', householdId),
  ])

  if (!tmplRes.data) notFound()

  return (
    <TemplateEditor
      template={tmplRes.data}
      initialLines={linesRes.data || []}
      items={itemsRes.data || []}
      sections={sectionsRes.data || []}
      stores={(storesRes.data || []).map((s: any) => s.stores).filter(Boolean)}
    />
  )
}
