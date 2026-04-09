# ============================================================
# backend/core/utils.py — Helpers partagés
# ============================================================

def filter_by_farm(query, user, model):
    """
    Filtre une query SQLAlchemy par fermes autorisées.
    
    admin    → voit tout
    agronome → voit ses N fermes (farm_names: list)
    operateur→ voit sa 1 ferme  (farm_names: [une_ferme])
    auditeur → voit sa 1 ferme  (farm_names: [une_ferme])
    
    Usage :
        from core.utils import filter_by_farm
        query = db.query(Device).filter(Device.is_active == True)
        query = filter_by_farm(query, user, Device)
        devices = query.all()
    """
    if user["role"] == "admin":
        return query

    farms = user.get("farm_names", [])
    if not farms:
        return query.filter(False)  # aucune ferme → rien visible

    return query.filter(model.farm_name.in_(farms))