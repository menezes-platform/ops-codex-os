import json
import unittest
from gateway_readonly import collect

class ProbeTests(unittest.TestCase):
 def test_missing_binding_makes_no_requests(self):
  def never(*args): raise AssertionError('must not call API')
  self.assertEqual(collect(never,''),{'state':'TOKEN_NOT_BOUND','writes':0,'requests':[]})
 def test_response_is_allowlisted_and_production_identity_checked(self):
  calls=[]
  def get(path,token):
   calls.append(path)
   if path=='/api/hosting/v1/websites?per_page=100&page=1':
    return 200,{'data':[{'username':'u775492464','domain':'darkslategrey-raccoon-448222.hostingersite.com','website_type':'nodejs'}], 'secret':'DO_NOT_LOG'}
   if path.endswith('/settings'): return 200,{'data':{'node_version':'24','entry_file':'private-path','secret':'DO_NOT_LOG'}}
   return 200,{'data':[{'state':'deployed','uuid':'private-build-id','repo':'private-repo'}]}
  report=collect(get,'SECRET_TOKEN')
  self.assertTrue(report['productionTargetPresent'])
  self.assertEqual(report['nodeVersion'],'24')
  self.assertEqual(report['writes'],0)
  self.assertEqual(len(calls),3)
  for forbidden in ['DO_NOT_LOG','SECRET_TOKEN','private-path','private-build-id','private-repo','u775492464']:
   self.assertNotIn(forbidden,json.dumps(report))
 def test_foreign_account_and_http_errors_do_not_leak_payloads(self):
  report=collect(lambda *_:(200,{'data':[{'username':'other','domain':'other'}]}),'token')
  self.assertFalse(report['productionTargetPresent']);self.assertEqual(len(report['requests']),1)
  report=collect(lambda *_:(503,{'message':'PRIVATE_SERVER_DATA'}),'token')
  self.assertEqual(report['requests'][0]['status'],503)
  self.assertNotIn('PRIVATE_SERVER_DATA',json.dumps(report))
if __name__=='__main__': unittest.main()
