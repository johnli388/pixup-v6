// Fixed SQL aliases only. A nullable LEFT JOIN result cannot prove an absent
// collection: PostgreSQL row policies may have hidden a real private parent.
export const collectionPublishedSql = `(a.collection_id IS NULL OR EXISTS (
  SELECT 1 FROM collections pc WHERE pc.id=a.collection_id AND pc.status='published'))`;
export const publicAssetSql = `(EXISTS (
  SELECT 1 FROM collections pc WHERE pc.id=a.collection_id AND pc.status='published')
  OR (a.collection_id IS NULL AND EXISTS (
    SELECT 1 FROM listings pl WHERE pl.asset_id=a.id AND pl.status IN ('active','reserved','sold'))))`;
// $1 is the authenticated user ID, $2 a server-derived staff scope.
export const visibleAssetSql = `(${publicAssetSql} OR a.owner_id=$1 OR $2::boolean
  OR EXISTS (SELECT 1 FROM memberships vm WHERE vm.org_id=a.inventory_org_id AND vm.user_id=$1)
  OR EXISTS (SELECT 1 FROM collections vc JOIN memberships vm ON vm.org_id=vc.org_id
    WHERE vc.id=a.collection_id AND vm.user_id=$1))`;
