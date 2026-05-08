window.APP_ROUTES = {
  ponto: { path: "/ponto", viewId: "view-ponto" },
  consultas: { path: "/consultas", viewId: "view-consultas" },
  adminOccurrences: { path: "/admin/occurrences", viewId: "view-admin-occurrences" },
  adminForgotten: { path: "/admin/forgotten", viewId: "view-admin-forgotten" },
  adminUsers: { path: "/admin/users", viewId: "view-admin-users" },
  adminCadastros: { path: "/admin/cadastros", viewId: "view-admin-cadastros" },
  adminAlerts: { path: "/admin/alerts", viewId: "view-admin-alerts" },
};

window.routeToViewId = function routeToViewId(routePath) {
  const routes = Object.values(window.APP_ROUTES);
  const found = routes.find((r) => r.path === routePath);
  return found ? found.viewId : window.APP_ROUTES.ponto.viewId;
};

window.viewIdToRoute = function viewIdToRoute(viewId) {
  const routes = Object.values(window.APP_ROUTES);
  const found = routes.find((r) => r.viewId === viewId);
  return found ? found.path : window.APP_ROUTES.ponto.path;
};
