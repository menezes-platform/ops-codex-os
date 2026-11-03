"""Bounded, read-only Hostinger capability probe. Outputs no raw API payloads."""
import json
import os
import re
import urllib.error
import urllib.request

TARGET_USER='u775492464'
TARGET_DOMAIN='darkslategrey-raccoon-448222.hostingersite.com'
BASE='/api/hosting/v1/accounts/'+TARGET_USER+'/websites/'+TARGET_DOMAIN+'/nodejs/builds'

def collect(get,token):
 if not token:
  return {'state':'TOKEN_NOT_BOUND','writes':0,'requests':[]}
 report={'state':'READ_ONLY_PROBE','writes':0,'requests':[]}
 def request(label,path):
  status,payload=get(path,token)
  report['requests'].append({'operation':label,'status':status})
  return payload if status==200 else None
 sites=request('verify_production_identity','/api/hosting/v1/websites?per_page=100&page=1')
 if not sites:
  return report
 rows=sites.get('data',[]) if isinstance(sites,dict) else sites
 report['productionTargetPresent']=any(s.get('username')==TARGET_USER and s.get('domain')==TARGET_DOMAIN and s.get('website_type')=='nodejs' for s in rows if isinstance(s,dict))
 if not report['productionTargetPresent']:
  return report
 settings=request('production_build_settings',BASE+'/settings')
 if isinstance(settings,dict):
  values=settings.get('data',settings)
  version=str(values.get('node_version','')) if isinstance(values,dict) else ''
  report['nodeVersion']=version if re.fullmatch(r'[0-9v.x-]{1,20}',version) else None
 request('production_build_history',BASE+'?per_page=1&page=1')
 return report

def api_get(path,token):
 req=urllib.request.Request('https://developers.hostinger.com'+path,method='GET',headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=15) as response:
   raw=response.read(1024*1024)
   try: return response.status,json.loads(raw)
   except (ValueError,UnicodeError): return response.status,None
 except urllib.error.HTTPError as error:
  error.close()
  return error.code,None
 except Exception:
  return 0,None

if __name__=='__main__':
 report=collect(api_get,os.environ.get('HOSTINGER_API_TOKEN',''))
 print(json.dumps(report,sort_keys=True))
 raise SystemExit(0 if report.get('productionTargetPresent') and all(r['status']==200 for r in report['requests']) else 2)
