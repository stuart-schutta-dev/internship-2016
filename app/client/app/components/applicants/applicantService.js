//calls Applicant from the backend
applicantServices.factory('Applicant', ['$resource', function($resource) {
 return $resource('service/applicants/:id', null, {
  'query': {
    method: 'GET',
    isArray: false
  }
 });
}]);