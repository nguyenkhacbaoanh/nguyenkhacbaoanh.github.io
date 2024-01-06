---
title: Hive & Trino Materialized View
description: Using Materialized View to improve query result for end client.
date: 2023-02-01
draft: false
slug: /pensieve/materialized-view
tags:
  - Hive
  - Trino
  - Materialized View
---

Datalake On-promise a Societe Generale, on utilise Hive 4.0(Cloudera version 7.x) et Trino/Starburst Cluster pour faire des requetages analytiques, dans ce context, je partis en pilot pour faire la comparaison entre les deux view materilise:

- Travaille avec l'equipe infrastructure Datalake(LUCID) pour relever des problemes rencontree.
- Partage des retours avec l'editor Starburst/Trino pour les pointes bloquant au niveau d'activation Cache Service, Data Product et aussi la securite (impersonation)
- Implemtation sur la DEV pour la partie technique et sur la PRD pour la partie performance.

## HIVE

```sql
DROP MATERIALIZED VIEW prd_uv_ptv_a8688_proratavat.multiapp_control_materialized_view;
DESCRIBE FORMATTED prd_uv_ptv_a8688_proratavat.multiapp_control_materialized_view;
CREATE MATERIALIZED VIEW prd_uv_ptv_a8688_proratavat.multiapp_control_materialized_view PARTITIONED ON (fiscal_year)
stored as orc
location '/prd/uv/ptv_a8688/uv_ptv_a8688_proratavat/anh_test_materialized_view/multi_app_control'
as
with gl as (
	select 
		fiscal_year,
	  	code_pci,
	  	altacct_descr,
		SORT_ARRAY(COLLECT_SET(source)) multiappl_array_brute,
		CONCAT_WS(',', SORT_ARRAY(COLLECT_SET(source))) multiappl_liste_brute,
		SORT_ARRAY(COLLECT_SET(event_nature)) event_nature_array_brute
	from (
		select
			uv.fiscal_year, 	
			code_pci,
			altacct_descr,
			source,
			trim(event_nature) event_nature
		from ( 
			select distinct
				fiscal_year,
				cast(if(length(accounting_period) < 3, accounting_period, substr(accounting_period,-2)) as int) accounting_period_2,
				altacct code_pci,
				altacct_descr,
				source,
				event_nature
			from prd_suv_fni_a8401_glapf.suv_glapf 
	 		where business_unit	= 'G0001' 
	  	  	  and cast(fiscal_year as integer) 	in (year(current_date), year(current_date) -1 )
			  and if( fiscal_year = cast(year(current_date) as string), 
						cast(accounting_period as integer) between 1 and month(current_date)-1 
						or accounting_period = concat('9', lpad(cast(month(current_date)-1 as string),2,'0')) 
					,
						cast(accounting_period as integer) between 1 and 12
						or accounting_period = '912')			  
		      and ledger 						= 'ACTUAL7003'
	  	      and origine 						!= 'QTZ'
--UPDATE JMC 20230317
		      and source 						not in ('RVM', 'MIG')
			  and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
--END UPDATE JMC 20230317				  
			  --PNL & BILAN
		      and (
		           substr(altacct, 1, 3) 		in ('976','977','986','987','996','997')
		        or substr(altacct, 1, 3)        not in ('979','989','999'))			  
		) uv
		inner join ( 
			select distinct 
				cast(year(cast(insert_date as date)) as string) fiscal_year,
				month(cast(insert_date as date)) accounting_period,
				comptepci_numero,
				cpt_codepcec 
			from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc refe
			inner join (						
				select 
					max(insert_date) max_insert_date,
				    cast(year(cast(insert_date as date)) as string) as fiscal_year   
				from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc
				where year(cast(insert_date as date)) in (year(current_date), year(current_date) -1 )
				group by cast(year(cast(insert_date as date)) as string)
			) refe_max
				on refe.insert_date = refe_max.max_insert_date
				and cast(year(cast(refe.insert_date as date)) as string) = refe_max.fiscal_year
			where cpt_codepcec not in ('699', '799', '000000', '001000', '002000', '003000', '004000')
		) wi
			on uv.fiscal_year 			= wi.fiscal_year
			and uv.code_pci 			= wi.comptepci_numero
	) uv2
	group by 
		fiscal_year, 	
		code_pci,
		altacct_descr
),
prorata as (
	select 
	    fiscal_year,
	    altacct as code_pci,
	    SORT_ARRAY(COLLECT_SET(coalesce(source,'#'))) multiappl_array_prorata,
		CONCAT_WS(',', SORT_ARRAY(COLLECT_SET(source))) multiappl_liste_prorata,
		SORT_ARRAY(COLLECT_SET(coalesce(event_nature,'#'))) event_nature_array_prorata,
		CONCAT_WS(',', SORT_ARRAY(COLLECT_SET(event_nature))) event_nature_liste_prorata
	from prd_uv_ptv_a8688_proratavat.uv_proratavat
	where cast(fiscal_year as integer) in (year(current_date), year(current_date) -1 )
	  and origine 		!= 'QTZ'
	  -- Avant retraitement
	  and nom_retraitement is null
	  --PNL & BILAN
	  and (substr(altacct, 1, 3) in ('976','977','986','987','996','997')
	   or substr(altacct, 1, 3) not in ('979','989','999'))
--UPDATE JMC 20230317
	  and source 						not in ('RVM', 'MIG')
	  and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
--END UPDATE JMC 20230317			   
	  group by 
		fiscal_year, 
		altacct 
),
result as (
select gl2.*,
    prorata.multiappl_liste_prorata,
    prorata.multiappl_array_prorata,
    prorata.event_nature_liste_prorata,
    prorata.event_nature_array_prorata,
    if(prorata.code_pci is not null, 'OK','KO') pci_in_prorata,
--UPDATE JMC 20230317
	--if(gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata, 'OK','KO') all_appl_srce_in_prorata,
	case 
		when gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata then 'OK'
		when prorata.code_pci is null then 'N/A'
		else 'KO'
	end all_appl_srce_in_prorata
--END UPDATE JMC 20230317	   
       --array_intersect(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) source_g_ds_prorata,
       --if( prorata.multiappl_liste_prorata is null, gl2.multiappl_array_brute, array_except(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) ) source_gl_pas_ds_prorata,
       --if( prorata.event_nature_liste_prorata is null, gl2.event_nature_array_brute, array_except(gl2.event_nature_array_brute,prorata.event_nature_array_prorata) ) event_nat_gl_pas_ds_prorata
from ( 
	select *
	from gl
	where INSTR(multiappl_liste_brute, ',') !=0
) gl2
left join prorata
	on gl2.fiscal_year	= prorata.fiscal_year
	and gl2.code_pci 	= prorata.code_pci
)
select fiscal_year,code_pci,altacct_descr,multiappl_array_brute,multiappl_liste_brute,event_nature_array_brute,multiappl_liste_prorata,multiappl_array_prorata,pci_in_prorata,all_appl_srce_in_prorata,
	collect_set(CASE WHEN ARRAY_CONTAINS(multiappl_array_prorata, e.elem) THEN e.elem ELSE NULL END) source_g_ds_prorata,
	if( multiappl_liste_prorata is null, multiappl_array_brute, collect_set(CASE WHEN ARRAY_CONTAINS(multiappl_array_prorata, e.elem) THEN NULL ELSE e.elem END) ) source_gl_pas_ds_prorata,
    if( event_nature_liste_prorata is null, event_nature_array_brute, collect_set(CASE WHEN ARRAY_CONTAINS(event_nature_array_prorata, e1.elem1) THEN NULL ELSE e1.elem1 END) ) event_nat_gl_pas_ds_prorata
from result
LATERAL VIEW EXPLODE(multiappl_array_brute) e as elem
LATERAL VIEW EXPLODE(event_nature_array_brute) e1 as elem1
--where fiscal_year = '2022' or fiscal_year = '2021' or fiscal_year = '2020'
GROUP BY fiscal_year,code_pci,altacct_descr,multiappl_array_brute,multiappl_liste_brute,event_nature_array_brute,multiappl_liste_prorata,event_nature_liste_prorata,multiappl_array_prorata,pci_in_prorata,all_appl_srce_in_prorata
;
ALTER MATERIALIZED VIEW prd_uv_ptv_a8688_proratavat.multiapp_control_materialized_view REBUILD;
```

## Trino View

```sql
create or replace view prd_uv_ptv_a8688_proratavat.prorata_multiappl_control_brut_view_prorata_view SECURITY INVOKER as 
--1 Comparaison base brute / base prorata sur PCI Multi application
with gl as (
	select 
		fiscal_year,
	  	code_pci,
	  	altacct_descr,
		ARRAY_SORT(ARRAY_AGG(distinct source)) multiappl_array_brute,
		ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct source)), ',') multiappl_liste_brute,
		ARRAY_SORT(ARRAY_AGG(distinct event_nature)) event_nature_array_brute
	from (
		select
			uv.fiscal_year, 	
			code_pci,
			altacct_descr,
			source,
			trim(event_nature) event_nature
		from ( 
			select distinct
				fiscal_year,
				cast(if(length(accounting_period) < 3, accounting_period, substr(accounting_period,-2)) as int) accounting_period_2,
				altacct code_pci,
				altacct_descr,
				source,
				event_nature
			from prd_suv_fni_a8401_glapf.suv_glapf 
	 		where business_unit	= 'G0001' 
	  	  	  and cast(fiscal_year as integer) 	in (year(current_date), year(current_date) -1 )
			  and if( fiscal_year = cast(year(current_date) as varchar), 
						cast(accounting_period as integer) between 1 and month(current_date)-1 
						or accounting_period = concat('9', lpad(cast(month(current_date)-1 as varchar),2,'0')) 
					,
						cast(accounting_period as integer) between 1 and 12
						or accounting_period = '912')			  
		      and ledger 						= 'ACTUAL7003'
	  	      and origine 						!= 'QTZ'
--UPDATE JMC 20230317
		      and source 						not in ('RVM', 'MIG')
			  and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
--END UPDATE JMC 20230317				  
			  --PNL & BILAN
		      and (
		           substr(altacct, 1, 3) 		in ('976','977','986','987','996','997')
		        or substr(altacct, 1, 3)        not in ('979','989','999'))			  
		) uv
		inner join ( 
			select distinct 
				cast(year(cast(insert_date as date)) as varchar) fiscal_year,
				month(cast(insert_date as date)) accounting_period,
				comptepci_numero,
				cpt_codepcec 
			from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc refe
			inner join (						
				select 
					max(insert_date) max_insert_date,
				    cast(year(cast(insert_date as date)) as varchar) as fiscal_year   
				from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc
				where year(cast(insert_date as date)) in (year(current_date), year(current_date) -1 )
				group by cast(year(cast(insert_date as date)) as varchar)
			) refe_max
				on refe.insert_date = refe_max.max_insert_date
				and cast(year(cast(refe.insert_date as date)) as varchar) = refe_max.fiscal_year
			where cpt_codepcec not in ('699', '799', '000000', '001000', '002000', '003000', '004000')
		) wi
			on uv.fiscal_year 			= wi.fiscal_year
			and uv.code_pci 			= wi.comptepci_numero
	) uv2
	group by 
		fiscal_year, 	
		code_pci,
		altacct_descr
),
prorata as (
	select 
	    fiscal_year,
	    altacct as code_pci,
	    ARRAY_SORT(ARRAY_AGG(distinct coalesce(source,'#'))) multiappl_array_prorata,
		ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct source)), ',') multiappl_liste_prorata,
		ARRAY_SORT(ARRAY_AGG(distinct coalesce(event_nature,'#'))) event_nature_array_prorata,
		ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct event_nature)), ',') event_nature_liste_prorata
	from prd_uv_ptv_a8688_proratavat.uv_proratavat
	where cast(fiscal_year as integer) in (year(current_date), year(current_date) -1 )
	  and origine 		!= 'QTZ'
	  -- Avant retraitement
	  and nom_retraitement is null
	  --PNL & BILAN
	  and (substr(altacct, 1, 3) in ('976','977','986','987','996','997')
	   or substr(altacct, 1, 3) not in ('979','989','999'))
--UPDATE JMC 20230317
	  and source 						not in ('RVM', 'MIG')
	  and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
--END UPDATE JMC 20230317			   
	group by 
		fiscal_year, 
		altacct 
)
select gl2.*,
    prorata.multiappl_liste_prorata,
    prorata.multiappl_array_prorata,
    if(prorata.code_pci is not null, 'OK','KO') pci_in_prorata,
--UPDATE JMC 20230317
	--if(gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata, 'OK','KO') all_appl_srce_in_prorata,
	case 
		when gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata then 'OK'
		when prorata.code_pci is null then 'N/A'
		else 'KO'
	end all_appl_srce_in_prorata,
--END UPDATE JMC 20230317	   
       array_intersect(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) source_g_ds_prorata,
       if( prorata.multiappl_liste_prorata is null, gl2.multiappl_array_brute, array_except(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) ) source_gl_pas_ds_prorata,
       if( prorata.event_nature_liste_prorata is null, gl2.event_nature_array_brute, array_except(gl2.event_nature_array_brute,prorata.event_nature_array_prorata) ) event_nat_gl_pas_ds_prorata
from ( 
	select *
	from gl
	where strpos(multiappl_liste_brute, ',') !=0
) gl2
left join prorata
	on gl2.fiscal_year	= prorata.fiscal_year
	and gl2.code_pci 	= prorata.code_pci
;
```

## Starburst

```sql
CREATE SCHEMA hive_default_lucid_dev.views_cache_storage WITH (location = '/dev/suv/fni_a8401/suv_fni_a8401_accounting_granular/views_cache_storage/');

CREATE SCHEMA hive_default_lucid_dev.views_schema WITH (location = '/dev/suv/fni_a8401/suv_fni_a8401_accounting_granular/views_schemas');

CREATE MATERIALIZED VIEW hive_default_lucid_dev.tax_data.prorata_multiappl_control_brut_view_prorata_view
WITH (
   grace_period = '10.00m',
   max_import_duration = '30.00m',
   refresh_interval = '12.00h',
   run_as_invoker = false
) AS
select gl2.*,
    prorata.multiappl_liste_prorata,
    prorata.multiappl_array_prorata,
    if(prorata.code_pci is not null, 'OK','KO') pci_in_prorata,
--UPDATE JMC 20230317
	--if(gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata, 'OK','KO') all_appl_srce_in_prorata,
	case 
		when gl2.multiappl_liste_brute = prorata.multiappl_liste_prorata then 'OK'
		when prorata.code_pci is null then 'N/A'
		else 'KO'
	end all_appl_srce_in_prorata,
--END UPDATE JMC 20230317	   
       array_intersect(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) source_g_ds_prorata,
       if( prorata.multiappl_liste_prorata is null, gl2.multiappl_array_brute, array_except(gl2.multiappl_array_brute,prorata.multiappl_array_prorata) ) source_gl_pas_ds_prorata,
       if( prorata.event_nature_liste_prorata is null, gl2.event_nature_array_brute, array_except(gl2.event_nature_array_brute,prorata.event_nature_array_prorata) ) event_nat_gl_pas_ds_prorata
from ( 
	select *
	from (
        select 
            fiscal_year,
            code_pci,
            altacct_descr,
            ARRAY_SORT(ARRAY_AGG(distinct source)) multiappl_array_brute,
            ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct source)), ',') multiappl_liste_brute,
            ARRAY_SORT(ARRAY_AGG(distinct event_nature)) event_nature_array_brute
        from (
            select
                uv.fiscal_year, 	
                code_pci,
                altacct_descr,
                source,
                trim(event_nature) event_nature
            from ( 
                select distinct
                    fiscal_year,
                    cast(if(length(accounting_period) < 3, accounting_period, substr(accounting_period,-2)) as int) accounting_period_2,
                    altacct code_pci,
                    altacct_descr,
                    source,
                    event_nature
                from prd_suv_fni_a8401_glapf.suv_glapf 
                where business_unit	= 'G0001' 
                and cast(fiscal_year as integer) 	in (year(current_date), year(current_date) -1 )
                and if( fiscal_year = cast(year(current_date) as varchar), 
                            cast(accounting_period as integer) between 1 and month(current_date)-1 
                            or accounting_period = concat('9', lpad(cast(month(current_date)-1 as varchar),2,'0')) 
                        ,
                            cast(accounting_period as integer) between 1 and 12
                            or accounting_period = '912')			  
                and ledger 						= 'ACTUAL7003'
                and origine 						!= 'QTZ'
    --UPDATE JMC 20230317
                and source 						not in ('RVM', 'MIG')
                and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
    --END UPDATE JMC 20230317				  
                --PNL & BILAN
                and (
                    substr(altacct, 1, 3) 		in ('976','977','986','987','996','997')
                    or substr(altacct, 1, 3)        not in ('979','989','999'))			  
            ) uv
            inner join ( 
                select distinct 
                    cast(year(cast(insert_date as date)) as varchar) fiscal_year,
                    month(cast(insert_date as date)) accounting_period,
                    comptepci_numero,
                    cpt_codepcec 
                from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc refe
                inner join (						
                    select 
                        max(insert_date) max_insert_date,
                        cast(year(cast(insert_date as date)) as varchar) as fiscal_year   
                    from prd_srv_nsa_a2274_nosica.sv_nsa_fnichartacc
                    where year(cast(insert_date as date)) in (year(current_date), year(current_date) -1 )
                    group by cast(year(cast(insert_date as date)) as varchar)
                ) refe_max
                    on refe.insert_date = refe_max.max_insert_date
                    and cast(year(cast(refe.insert_date as date)) as varchar) = refe_max.fiscal_year
                where cpt_codepcec not in ('699', '799', '000000', '001000', '002000', '003000', '004000')
            ) wi
                on uv.fiscal_year 			= wi.fiscal_year
                and uv.code_pci 			= wi.comptepci_numero
        ) uv2
        group by 
            fiscal_year, 	
            code_pci,
            altacct_descr
    ) gl
	where strpos(multiappl_liste_brute, ',') !=0
) gl2
left join (
    select 
	    fiscal_year,
	    altacct as code_pci,
	    ARRAY_SORT(ARRAY_AGG(distinct coalesce(source,'#'))) multiappl_array_prorata,
		ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct source)), ',') multiappl_liste_prorata,
		ARRAY_SORT(ARRAY_AGG(distinct coalesce(event_nature,'#'))) event_nature_array_prorata,
		ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(distinct event_nature)), ',') event_nature_liste_prorata
	from prd_uv_ptv_a8688_proratavat.uv_proratavat
	where cast(fiscal_year as integer) in (year(current_date), year(current_date) -1 )
	  and origine 		!= 'QTZ'
	  -- Avant retraitement
	  and nom_retraitement is null
	  --PNL & BILAN
	  and (substr(altacct, 1, 3) in ('976','977','986','987','996','997')
	   or substr(altacct, 1, 3) not in ('979','989','999'))
--UPDATE JMC 20230317
	  and source 						not in ('RVM', 'MIG')
	  and substr(altacct, 1, 3) 	    not in ('991', '992', '994','995') --filtrer les comptes de bilan
--END UPDATE JMC 20230317			   
	group by 
		fiscal_year, 
		altacct 
) prorata
	on gl2.fiscal_year	= prorata.fiscal_year
	and gl2.code_pci 	= prorata.code_pci
;

ALTER MATERIALIZED VIEW hive_default_lucid_dev.tax_data.prorata_multiappl_control_brut_view_prorata_view SET PROPERTIES partitioning = ARRAY['fiscal_year'];

REFRESH MATERIALIZED VIEW hive_default_lucid_dev.tax_data.prorata_multiappl_control_brut_view_prorata_view;

SELECT * FROM "system"."metadata"."materialized_views" LIMIT 10;
```

## Resources
