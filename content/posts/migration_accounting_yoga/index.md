---
title: Migration Systeme Comptabilite
description: Dans le cadre de migration entre Societe Generale et Credit du Nord, je m'occupe sur la partie du projet pour restitution de la data afin de control les phrase de la migration
date: 2022-11-01
draft: false
slug: /pensieve/yoga
tags:
  - Datalake
  - Finance/Comptable
  - Control data quality
---

## Architecture

![Architecture de projet](./yoga_architecture.png 'architecture')

## Data Flow

![Data flow](./pipelines.png 'pipeline jobs')

## Control Data

### Control KPI

```sql
/*****************************
PROD - KPI YOGA

maj : 01/03/2023
******************************/

--Change the phase value 
@set phase = 'BR2'

with rcc_kpi as
(select 
  	code_irt_bdf, label_irt_bdf, 
  	phase,
  	count(1) as nb_cnt_total,
  	count(case when flag_cnt_found = 'Y' then 1 end) as nb_ctn_rapp,
  	count(case when flag_cnt_amount_matched = 'Y' then 1 end) as nb_ctn_reconl,
  	count(case when flag_dep_pci = 'P' then 1 end) as nb_ctn_deport
	from hive_default_lucid_prd.prd_suv_fni_a8401_accounting_granular.suv_rcc_yoga
  	where 1=1
  	and phase = ${phase}
  	and flag_pci_remove = 'N' 
  	and coalesce(code_irt_bdf, 'AAAAA') not in ('A0021', 'A1787')
  	group by code_irt_bdf, label_irt_bdf, phase
  	order by label_irt_bdf asc nulls first
)
select
  code_irt_bdf, label_irt_bdf,phase,
  nb_cnt_total, nb_ctn_rapp,
  round((cast(nb_ctn_rapp as double) / cast(nb_cnt_total as double)), 4) * 100 as pct_cnt_rapp,
  nb_ctn_reconl,
  round((cast(nb_ctn_reconl as double) / cast(nb_cnt_total as double)), 4) * 100 as pct_cnt_reconl,
  nb_ctn_rapp - nb_ctn_reconl as nb_ctn_rapp_nreconl,
  nb_ctn_deport,
  nb_cnt_total - nb_ctn_rapp as nb_ctn_nrapp
from rcc_kpi
;
```

### Control integration du SO

```sql
/*****************************
Controle Transco 

maj : 01/03/2023
******************************/

--Change the phase value 
@set phase = 'BR2'

/***Controle SRV ***/
select cd_banque_origin, count(*) 
from ${hive_default_lucid_prd.prd}_srv_fni_a8401_fda_datastructure.yoga_contracts_transco
where phase = ${phase}
group by cd_banque_origin;

/***Controle SUV ***/

-- Detail par SO
select cd_irt_so_cible, label_irt, count(*), trsc.insert_date
from hive_default_lucid_prd.prd_suv_fni_a8401_accounting_granular.suv_contracts_transco_yoga trsc
left outer join hive_default_lucid_prd.prd_srv_fni_a8401_fda_datastructure.sv_fni_ref_irt irt on (cd_irt_so_cible = irt.code_irt)
where phase = ${phase} 
group by cd_irt_so_cible, label_irt, trsc.insert_date
order by 2;

-- Par Banque
select cd_banque_origin, trsc.insert_date, phase, count(*) 
from hive_default_lucid_prd.prd_suv_fni_a8401_accounting_granular.suv_contracts_transco_yoga trsc
where phase = ${phase}
group by cd_banque_origin, trsc.insert_date, phase
order by 1;
```

### Control data daily pour des jours ouvres

```sql
/*****************************
PROD des SRV YOGA

maj : 01/03/2023
******************************/

@set env_ins_dt = '2023-05-13'

--Controle des CRE recus par SO
select 
cgxmj.insert_date, 
cgxmj.cdirt as IRT,
label_irt,
case when cgxmj.cdggpn in ('07141','07142','07143','07144','07145','07146','07147','07148','07149') then 'YOGA' else 'RCGG' end as Type_CRE,
count(*) as Nbre
from hive_default_lucid_prd.prd_srv_nsa_a2274_nosica.sv_cgxmj_bis cgxmj
left outer join hive_default_lucid_prd.prd_srv_nsa_a2274_nosica.sv_cgxmd cgxmd on (cgxmj.aggid = cgxmd.aggid 
and cgxmj.nuecr5 = cgxmd.nuecr5 
and cgxmj.nulimv = cgxmd.nulimv)
left outer join hive_default_lucid_prd.prd_srv_fni_a8401_fda_datastructure.sv_fni_ref_irt irt on (code_irt = cgxmj.cdirt)
where 
cgxmj.insert_date >= ${env_ins_dt}
--Uncomment his filter to keep only the CRE YOGA
--and cgxmj.cdggpn in ('07141','07142','07143','07144','07145','07146','07147','07148','07149')
group by 
cgxmj.insert_date, 
cgxmj.cdirt,
label_irt,
case when cgxmj.cdggpn in ('07141','07142','07143','07144','07145','07146','07147','07148','07149') then 'YOGA' else 'RCGG' end
order by 4 desc, 2 asc, 1;
```
